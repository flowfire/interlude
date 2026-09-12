import { create } from 'zustand'
import { markDownstreamStale, type StepIndex } from '@/engine/graph/stepGraph'
import {
  DEFAULT_SESSION_TITLE,
  type LedgerEntry,
  type Round,
  type Session,
  type Step,
} from '@/types/step'
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  type LlmSettings,
  type ProjectSettings,
} from '@/types/settings'
import type { Segment } from '@/types/segment'
import { makeId } from '@/utils/id'
import { nowIso } from '@/utils/time'

export interface WorkspaceSnapshot {
  sessions: Session[]
  rounds: Round[]
  steps: StepIndex
  ledger: LedgerEntry[]
}

export interface AppState extends WorkspaceSnapshot {
  llm: LlmSettings
  project: ProjectSettings
  activeSessionId: string | null
  selectedStepId: string | null
  busy: boolean
  statusText: string
  error: string | null
  settingsOpen: boolean
  inspectorStepId: string | null
  /** 最近一次破坏性操作之前的快照（丢弃轮次 / 清空步骤 / 删除对话），用于撤销 */
  undoSnapshot: WorkspaceSnapshot | null
  undoLabel: string | null

  saveUndo: (label: string) => void
  undoLast: () => void

  setLlm: (patch: Partial<LlmSettings>) => void
  setProject: (patch: Partial<ProjectSettings>) => void
  setSettingsOpen: (open: boolean) => void
  setInspector: (stepId: string | null) => void
  setBusy: (busy: boolean) => void
  setStatusText: (text: string) => void
  setError: (error: string | null) => void

  newSession: () => Session
  setActiveSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  autoTitleSession: (sessionId: string, title: string) => void
  deleteSession: (sessionId: string) => void

  newRound: (userInput: string) => Round
  updateRoundInput: (roundId: string, userInput: string) => void
  /** 作废某一轮之后的所有轮次（同一对话内）—— 时间线从那里重新开始 */
  truncateAfterRound: (roundId: string) => void
  /** 清掉某一轮的所有步骤与账本 —— 改了原文之后整棵步骤树要重建（角色可能变了） */
  clearRoundSteps: (roundId: string) => void

  mergeSteps: (incoming: StepIndex, ledger?: LedgerEntry[]) => void
  updateStepOutput: (stepId: string, output: unknown) => void
  updateSegment: (stepId: string, segmentId: string, patch: Partial<Segment>) => void
  toggleStepLock: (stepId: string) => void
  selectStep: (stepId: string | null) => void

  loadSnapshot: (snapshot: WorkspaceSnapshot) => void
  resetWorkspace: () => void
}

function deriveRoundStatus(steps: StepIndex, roundId: string): Round['status'] {
  const own = Object.values(steps).filter((step) => step.roundId === roundId)
  if (!own.length) return 'draft'
  if (own.some((step) => step.status === 'running')) return 'running'
  if (own.some((step) => step.status === 'error')) return 'error'
  if (own.every((step) => step.status === 'done' || step.lockedByUser)) return 'done'
  return 'draft'
}

function reindexRounds(rounds: Round[], steps: StepIndex): Round[] {
  return rounds.map((round) => {
    const stepIds = Object.values(steps)
      .filter((step) => step.roundId === round.id)
      .map((step) => step.id)
    const nextStatus = deriveRoundStatus(steps, round.id)
    if (stepIds.length === round.stepIds.length && nextStatus === round.status) return round
    return { ...round, stepIds, status: nextStatus, updatedAt: nowIso() }
  })
}

function createSessionRecord(): Session {
  const timestamp = nowIso()
  return { id: makeId('ses'), title: DEFAULT_SESSION_TITLE, createdAt: timestamp, updatedAt: timestamp }
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  rounds: [],
  steps: {},
  ledger: [],
  llm: { ...DEFAULT_LLM_SETTINGS },
  project: { ...DEFAULT_PROJECT_SETTINGS },
  activeSessionId: null,
  selectedStepId: null,
  busy: false,
  statusText: '',
  error: null,
  settingsOpen: false,
  inspectorStepId: null,
  undoSnapshot: null,
  undoLabel: null,

  /** 破坏性操作前调用一次，记下当时的整份工作区 */
  saveUndo: (label) =>
    set((state) => ({
      undoSnapshot: {
        sessions: state.sessions,
        rounds: state.rounds,
        steps: state.steps,
        ledger: state.ledger,
      },
      undoLabel: label,
    })),

  undoLast: () =>
    set((state) => {
      if (!state.undoSnapshot) return {}
      return {
        ...state.undoSnapshot,
        undoSnapshot: null,
        undoLabel: null,
        selectedStepId: null,
        inspectorStepId: null,
      }
    }),

  setLlm: (patch) => set((state) => ({ llm: { ...state.llm, ...patch } })),
  setProject: (patch) => set((state) => ({ project: { ...state.project, ...patch } })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setInspector: (inspectorStepId) => set({ inspectorStepId }),
  setBusy: (busy) => set({ busy }),
  setStatusText: (statusText) => set({ statusText }),
  setError: (error) => set({ error }),

  newSession: () => {
    const session = createSessionRecord()
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
      selectedStepId: null,
      inspectorStepId: null,
      error: null,
    }))
    return session
  },

  setActiveSession: (activeSessionId) =>
    set({ activeSessionId, selectedStepId: null, inspectorStepId: null, error: null }),

  renameSession: (sessionId, title) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, title: title.trim() || DEFAULT_SESSION_TITLE, updatedAt: nowIso() } : session,
      ),
    })),

  /** 只在该对话还没被命名过时才自动起名，不覆盖你手改的标题 */
  autoTitleSession: (sessionId, title) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId && (!session.title || session.title === DEFAULT_SESSION_TITLE)
          ? { ...session, title: title.trim().slice(0, 20) || DEFAULT_SESSION_TITLE, updatedAt: nowIso() }
          : session,
      ),
    })),

  deleteSession: (sessionId) =>
    set((state) => {
      const doomedRounds = new Set(state.rounds.filter((round) => round.sessionId === sessionId).map((round) => round.id))
      const steps: StepIndex = {}
      for (const [id, step] of Object.entries(state.steps)) {
        if (!doomedRounds.has(step.roundId)) steps[id] = step
      }
      const sessions = state.sessions.filter((session) => session.id !== sessionId)
      return {
        sessions,
        rounds: state.rounds.filter((round) => !doomedRounds.has(round.id)),
        steps,
        ledger: state.ledger.filter((entry) => !doomedRounds.has(entry.roundId)),
        activeSessionId:
          state.activeSessionId === sessionId ? (sessions.length ? sessions[sessions.length - 1].id : null) : state.activeSessionId,
        selectedStepId: null,
        inspectorStepId: null,
      }
    }),

  newRound: (userInput) => {
    const state = get()
    let sessions = state.sessions
    let sessionId = state.activeSessionId

    if (!sessionId || !sessions.some((session) => session.id === sessionId)) {
      const session = createSessionRecord()
      sessions = [...sessions, session]
      sessionId = session.id
    }

    const index = state.rounds.filter((round) => round.sessionId === sessionId).length + 1
    const timestamp = nowIso()
    const round: Round = {
      id: makeId('rnd'),
      sessionId,
      index,
      userInput,
      stepIds: [],
      rootStepIds: [],
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    set({
      sessions,
      activeSessionId: sessionId,
      rounds: [...state.rounds, round],
      selectedStepId: null,
      inspectorStepId: null,
      error: null,
    })
    return round
  },

  updateRoundInput: (roundId, userInput) =>
    set((state) => ({
      rounds: state.rounds.map((round) =>
        round.id === roundId ? { ...round, userInput, updatedAt: nowIso() } : round,
      ),
    })),

  truncateAfterRound: (roundId) =>
    set((state) => {
      const round = state.rounds.find((item) => item.id === roundId)
      if (!round) return {}

      const doomed = new Set(
        state.rounds
          .filter((item) => item.sessionId === round.sessionId && item.index > round.index)
          .map((item) => item.id),
      )
      if (!doomed.size) return {}

      const steps: StepIndex = {}
      for (const [id, step] of Object.entries(state.steps)) {
        if (!doomed.has(step.roundId)) steps[id] = step
      }

      const selectedStep = state.selectedStepId ? state.steps[state.selectedStepId] : undefined
      return {
        rounds: state.rounds.filter((item) => !doomed.has(item.id)),
        steps,
        ledger: state.ledger.filter((entry) => !doomed.has(entry.roundId)),
        selectedStepId: selectedStep && doomed.has(selectedStep.roundId) ? null : state.selectedStepId,
        inspectorStepId: null,
      }
    }),

  clearRoundSteps: (roundId) =>
    set((state) => {
      const steps: StepIndex = {}
      for (const [id, step] of Object.entries(state.steps)) {
        if (step.roundId !== roundId) steps[id] = step
      }
      return {
        steps,
        ledger: state.ledger.filter((entry) => entry.roundId !== roundId),
        rounds: state.rounds.map((round) =>
          round.id === roundId
            ? { ...round, stepIds: [], rootStepIds: [], status: 'draft', updatedAt: nowIso() }
            : round,
        ),
        selectedStepId: null,
        inspectorStepId: null,
      }
    }),

  mergeSteps: (incoming, ledger) =>
    set((state) => {
      const steps: StepIndex = { ...state.steps, ...incoming }
      return {
        steps,
        rounds: reindexRounds(state.rounds, steps),
        ledger: ledger ?? state.ledger,
      }
    }),

  updateStepOutput: (stepId, output) =>
    set((state) => {
      const step = state.steps[stepId]
      if (!step) return {}
      const withEdit: StepIndex = {
        ...state.steps,
        [stepId]: { ...step, output, editedByUser: true, updatedAt: nowIso() },
      }
      const steps = markDownstreamStale(withEdit, stepId)
      return { steps, rounds: reindexRounds(state.rounds, steps) }
    }),

  updateSegment: (stepId, segmentId, patch) =>
    set((state) => {
      const step = state.steps[stepId]
      if (!step) return {}
      const output = step.output as { segments?: Segment[] } | null
      if (!output?.segments) return {}

      const segments = output.segments.map((segment) => {
        if (segment.id !== segmentId) return segment
        const merged: Segment = { ...segment, ...patch, origin: segment.origin === 'rule' ? 'rule' : 'model' }
        if (patch.isFact !== undefined && segment.isFact !== patch.isFact) merged.lockedByUser = true
        return merged
      })

      const withEdit: StepIndex = {
        ...state.steps,
        [stepId]: { ...step, output: { ...output, segments }, editedByUser: true, updatedAt: nowIso() },
      }
      const steps = markDownstreamStale(withEdit, stepId)
      return { steps, rounds: reindexRounds(state.rounds, steps) }
    }),

  toggleStepLock: (stepId) =>
    set((state) => {
      const step = state.steps[stepId]
      if (!step) return {}
      return {
        steps: {
          ...state.steps,
          [stepId]: { ...step, lockedByUser: !step.lockedByUser, updatedAt: nowIso() },
        },
      }
    }),

  selectStep: (selectedStepId) => set({ selectedStepId }),

  loadSnapshot: (snapshot) =>
    set(() => {
      const sessions = snapshot.sessions ?? []
      const rounds = snapshot.rounds ?? []
      return {
        sessions,
        rounds,
        steps: snapshot.steps ?? {},
        ledger: snapshot.ledger ?? [],
        activeSessionId: sessions.length ? sessions[sessions.length - 1].id : null,
      }
    }),

  resetWorkspace: () =>
    set({
      sessions: [],
      rounds: [],
      steps: {},
      ledger: [],
      activeSessionId: null,
      selectedStepId: null,
      inspectorStepId: null,
      error: null,
    }),
}))
