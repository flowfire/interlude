import { DB_KEYS, dbGet, dbSet } from '@/db/store'
import type { LedgerEntry, Round, Session, Step } from '@/types/step'
import type { StepIndex } from '@/engine/graph/stepGraph'
import type { WorkspaceSnapshot } from './appStore'

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const [sessions, rounds, steps, ledger] = await Promise.all([
    dbGet<Session[]>(DB_KEYS.sessions),
    dbGet<Round[]>(DB_KEYS.rounds),
    dbGet<Record<string, Step>>(DB_KEYS.steps),
    dbGet<LedgerEntry[]>(DB_KEYS.ledger),
  ])

  return {
    sessions: Array.isArray(sessions) ? sessions : [],
    rounds: Array.isArray(rounds) ? rounds : [],
    steps: (steps && typeof steps === 'object' ? steps : {}) as StepIndex,
    ledger: Array.isArray(ledger) ? ledger : [],
  }
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  await Promise.all([
    dbSet(DB_KEYS.sessions, snapshot.sessions),
    dbSet(DB_KEYS.rounds, snapshot.rounds),
    dbSet(DB_KEYS.steps, snapshot.steps),
    dbSet(DB_KEYS.ledger, snapshot.ledger),
  ])
}
