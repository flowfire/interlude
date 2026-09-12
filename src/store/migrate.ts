import { makeId } from '@/utils/id'
import { nowIso } from '@/utils/time'
import type { LedgerEntry, Round, Session, Step } from '@/types/step'
import type { StepIndex } from '@/engine/graph/stepGraph'

export interface MigratableWorkspace {
  sessions: Session[]
  rounds: Round[]
  steps: StepIndex
  ledger: LedgerEntry[]
}

/**
 * 一次性迁移：把加入「对话」概念之前产生的旧数据收拢好。
 *
 * - 没有 sessionId 的轮次 → 归入一条「早先的对话」
 * - 轮次序号按对话重排（旧数据的序号是全局的，单条对话下其实没问题，这里只做兜底）
 */
export function migrateWorkspace(snapshot: MigratableWorkspace): {
  snapshot: MigratableWorkspace
  migrated: boolean
} {
  const { sessions, rounds, steps } = snapshot

  const orphanRounds = rounds.filter((round) => !round.sessionId)
  if (!orphanRounds.length) return { snapshot, migrated: false }

  const timestamp = nowIso()
  const session: Session = {
    id: makeId('ses'),
    title: '早先的对话',
    createdAt: orphanRounds[0]?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  const orphanIds = new Set(orphanRounds.map((round) => round.id))
  const nextRounds = rounds.map((round) => (orphanIds.has(round.id) ? { ...round, sessionId: session.id } : round))

  // 旧轮次的 index 是全局递增的，在单条对话里依然单调，保持原样即可
  return {
    snapshot: {
      sessions: [...sessions, session],
      rounds: nextRounds,
      steps,
      ledger: snapshot.ledger,
    },
    migrated: true,
  }
}
