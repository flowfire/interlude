import type { LedgerEntry } from '@/types/step'
import { makeId } from '@/utils/id'
import { nowIso } from '@/utils/time'

export type LedgerIndex = LedgerEntry[]

export interface NewLedgerEntry {
  roundId: string
  producedByStepId: string
  kind: LedgerEntry['kind']
  targetId: string
  payload?: unknown
}

export function createLedgerEntry(init: NewLedgerEntry): LedgerEntry {
  return {
    id: makeId('led'),
    roundId: init.roundId,
    producedByStepId: init.producedByStepId,
    kind: init.kind,
    targetId: init.targetId,
    payload: init.payload ?? null,
    createdAt: nowIso(),
  }
}

export function appendLedger(ledger: LedgerIndex, entries: NewLedgerEntry[]): LedgerIndex {
  if (!entries.length) return ledger
  return [...ledger, ...entries.map(createLedgerEntry)]
}

/**
 * 撤销一批账本条目。
 * 返回保留的账本与被撤销的条目（调用方据此回滚真实状态）。
 */
export function revokeLedger(
  ledger: LedgerIndex,
  entryIds: string[],
): { kept: LedgerIndex; revoked: LedgerEntry[] } {
  if (!entryIds.length) return { kept: ledger, revoked: [] }
  const target = new Set(entryIds)
  const kept: LedgerEntry[] = []
  const revoked: LedgerEntry[] = []
  for (const entry of ledger) {
    if (target.has(entry.id)) revoked.push(entry)
    else kept.push(entry)
  }
  return { kept, revoked }
}

/**
 * 重跑某个步骤时，需要连带撤销「该步骤及其所有下游」产生的账本条目。
 */
export function revokeBySteps(ledger: LedgerIndex, stepIds: string[]): { kept: LedgerIndex; revoked: LedgerEntry[] } {
  const target = new Set(stepIds)
  const kept: LedgerEntry[] = []
  const revoked: LedgerEntry[] = []
  for (const entry of ledger) {
    if (target.has(entry.producedByStepId)) revoked.push(entry)
    else kept.push(entry)
  }
  return { kept, revoked }
}

/** 按目标 id 撤销（例如「把某个角色卡回滚成上一版」） */
export function revokeByTarget(ledger: LedgerIndex, targetId: string): { kept: LedgerIndex; revoked: LedgerEntry[] } {
  const kept: LedgerEntry[] = []
  const revoked: LedgerEntry[] = []
  for (const entry of ledger) {
    if (entry.targetId === targetId) revoked.push(entry)
    else kept.push(entry)
  }
  return { kept, revoked }
}
