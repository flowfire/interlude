import { describe, expect, it } from 'vitest'
import {
  collectDownstream,
  createStep,
  markDownstreamStale,
  planRerun,
  topoSort,
  type StepIndex,
} from '@/engine/graph/stepGraph'
import { appendLedger, revokeBySteps, type LedgerIndex } from '@/engine/graph/ledger'
import type { StepStage } from '@/types/step'

function makeStep(stage: StepStage, label: string, deps: string[] = []) {
  return createStep({ roundId: 'r1', stage, label, deps, status: 'done' })
}

/** 构造一棵典型的依赖树：规范化 → 拆解 → 两份上下文 → 两个角色反应 → 编排 */
function buildTree() {
  const norm = makeStep('normalize', '规范化')
  const seg = makeStep('segment', '拆解', [norm.id])
  const ctxA = makeStep('context', '给林砚的上下文', [seg.id])
  const ctxB = makeStep('context', '给阿七的上下文', [seg.id])
  const roleA = makeStep('roleplay', '林砚的反应', [ctxA.id])
  const roleB = makeStep('roleplay', '阿七的反应', [ctxB.id])
  const compose = makeStep('compose', '编排', [roleA.id, roleB.id])

  const steps: StepIndex = {}
  for (const step of [norm, seg, ctxA, ctxB, roleA, roleB, compose]) steps[step.id] = step

  return { steps, norm, seg, ctxA, ctxB, roleA, roleB, compose }
}

describe('StepGraph', () => {
  it('能找出全部下游', () => {
    const { steps, seg, ctxA, ctxB, roleA, roleB, compose } = buildTree()
    const downstream = collectDownstream(steps, seg.id).sort()
    expect(downstream).toEqual([ctxA.id, ctxB.id, roleA.id, roleB.id, compose.id].sort())
  })

  it('拓扑排序保证上游在前', () => {
    const { steps, seg, ctxA, roleA, compose } = buildTree()
    const ordered = topoSort([compose.id, roleA.id, ctxA.id, seg.id], steps)
    expect(ordered.indexOf(seg.id)).toBeLessThan(ordered.indexOf(ctxA.id))
    expect(ordered.indexOf(ctxA.id)).toBeLessThan(ordered.indexOf(roleA.id))
    expect(ordered.indexOf(roleA.id)).toBeLessThan(ordered.indexOf(compose.id))
  })

  it('编辑一个分支只会作废它自己的下游，不会牵连另一个角色', () => {
    const { steps, ctxA, roleA, roleB, compose } = buildTree()
    const next = markDownstreamStale(steps, ctxA.id)

    expect(next[roleA.id].status).toBe('stale')
    expect(next[compose.id].status).toBe('stale')
    // 关键：阿七那条分支完全不受影响
    expect(next[roleB.id].status).toBe('done')
    expect(next[ctxA.id].status).toBe('done')
  })

  it('重跑计划只包含受影响的分支，其余步骤复用', () => {
    const { steps, ctxA, roleA, roleB, compose, norm } = buildTree()
    const stale = markDownstreamStale(steps, ctxA.id)
    const plan = planRerun(stale, [], ctxA.id)

    expect(plan.toRun.sort()).toEqual([ctxA.id, roleA.id, compose.id].sort())
    expect(plan.reused).toContain(roleB.id)
    expect(plan.reused).toContain(norm.id)
  })

  it('锁定的步骤会被跳过，产物直接复用', () => {
    const { steps, ctxA, roleA, compose } = buildTree()
    steps[roleA.id] = { ...steps[roleA.id], lockedByUser: true }
    const plan = planRerun(steps, [], ctxA.id)

    expect(plan.toRun).not.toContain(roleA.id)
    expect(plan.toRun).toContain(ctxA.id)
    expect(plan.toRun).toContain(compose.id)
  })

  it('账本能按步骤精确撤销', () => {
    let ledger: LedgerIndex = []
    ledger = appendLedger(ledger, [
      { roundId: 'r1', producedByStepId: 's-roleA', kind: 'memory', targetId: 'lin-yan' },
      { roundId: 'r1', producedByStepId: 's-roleB', kind: 'memory', targetId: 'aqi' },
      { roundId: 'r1', producedByStepId: 's-roleA', kind: 'relation', targetId: 'lin-yan->pc' },
    ])

    const { kept, revoked } = revokeBySteps(ledger, ['s-roleA'])
    expect(revoked).toHaveLength(2)
    expect(kept).toHaveLength(1)
    expect(kept[0].targetId).toBe('aqi')
  })
})
