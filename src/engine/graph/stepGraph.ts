import type { LedgerEntry, RerunPlan, Step, StepStage } from '@/types/step'
import { makeId } from '@/utils/id'
import { nowIso } from '@/utils/time'

export type StepIndex = Record<string, Step>

export interface NewStepInit<TOut> {
  roundId: string
  stage: StepStage
  label: string
  deps?: string[]
  inputSnapshot?: unknown
  output?: TOut
  status?: Step['status']
  model?: string
  meta?: Record<string, unknown>
}

export function createStep<TOut>(init: NewStepInit<TOut>): Step<TOut> {
  const timestamp = nowIso()
  return {
    id: makeId(init.stage.slice(0, 3)),
    roundId: init.roundId,
    stage: init.stage,
    label: init.label,
    deps: init.deps ?? [],
    inputSnapshot: init.inputSnapshot ?? null,
    output: (init.output ?? null) as TOut,
    meta: init.meta,
    status: init.status ?? 'pending',
    lockedByUser: false,
    editedByUser: false,
    model: init.model,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** 构建「上游 id -> 下游 ids」的反向索引 */
export function buildChildrenIndex(steps: StepIndex): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const step of Object.values(steps)) {
    for (const dep of step.deps) {
      const list = index.get(dep)
      if (list) list.push(step.id)
      else index.set(dep, [step.id])
    }
  }
  return index
}

/** 收集某个步骤的全部下游（不含它自己），BFS */
export function collectDownstream(steps: StepIndex, rootId: string): string[] {
  const children = buildChildrenIndex(steps)
  const seen = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }
  return [...seen]
}

/** 只对给定集合做拓扑排序（集合外的依赖忽略），有环时按发现顺序退化 */
export function topoSort(ids: string[], steps: StepIndex): string[] {
  const allowed = new Set(ids)
  const visited = new Set<string>()
  const out: string[] = []

  const visit = (id: string, stack: Set<string>) => {
    if (visited.has(id) || !allowed.has(id)) return
    if (stack.has(id)) return
    stack.add(id)
    for (const dep of steps[id]?.deps ?? []) visit(dep, stack)
    stack.delete(id)
    visited.add(id)
    out.push(id)
  }

  for (const id of ids) visit(id, new Set())
  return out
}

/**
 * 编辑某个步骤后：递归把它的所有下游标为 stale（产物已过期，需要重跑）。
 * 返回新的索引（不修改入参）。
 */
export function markDownstreamStale(steps: StepIndex, rootId: string): StepIndex {
  const downstream = collectDownstream(steps, rootId)
  if (!downstream.length) return steps
  const timestamp = nowIso()
  const next: StepIndex = { ...steps }
  for (const id of downstream) {
    const step = next[id]
    if (!step) continue
    if (step.status === 'stale') continue
    next[id] = { ...step, status: 'stale', updatedAt: timestamp }
  }
  return next
}

/**
 * 计算「从这一步重跑」的影响面：
 * - toRun：需要重算的步骤（拓扑序），已锁定的步骤会被跳过并复用
 * - reused：不受影响、可直接复用的已完成步骤
 * - revokedLedger：重跑前需要按账本撤销的副作用
 */
export function planRerun(steps: StepIndex, ledger: LedgerEntry[], rootId: string): RerunPlan {
  if (!steps[rootId]) {
    return { stepId: rootId, toRun: [], reused: [], revokedLedger: [] }
  }
  const affected = [rootId, ...collectDownstream(steps, rootId)]
  const affectedSet = new Set(affected)
  const ordered = topoSort(affected, steps)

  const toRun = ordered.filter((id) => !steps[id]?.lockedByUser)
  const reused = Object.values(steps)
    .filter((step) => !affectedSet.has(step.id) && step.status === 'done')
    .map((step) => step.id)
  const revokedLedger = ledger.filter((entry) => affectedSet.has(entry.producedByStepId)).map((entry) => entry.id)

  return { stepId: rootId, toRun, reused, revokedLedger }
}

/** 找到该步骤「已锁定的上游」中被跳过的那些，重跑时直接复用它们的产物 */
export function lockedUpstreamOf(steps: StepIndex, rootId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    for (const dep of steps[id]?.deps ?? []) {
      if (seen.has(dep)) continue
      seen.add(dep)
      if (steps[dep]?.lockedByUser) out.push(dep)
      walk(dep)
    }
  }
  walk(rootId)
  return out
}

/** 整轮的调用与 token 汇总 */
export function sumCost(steps: StepIndex, roundId?: string): { calls: number; tokensIn: number; tokensOut: number; ms: number } {
  const totals = { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 }
  for (const step of Object.values(steps)) {
    if (roundId && step.roundId !== roundId) continue
    if (!step.cost) continue
    totals.calls += step.cost.calls
    totals.tokensIn += step.cost.tokensIn
    totals.tokensOut += step.cost.tokensOut
    totals.ms += step.cost.ms
  }
  return totals
}
