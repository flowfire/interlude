import { create } from 'zustand'
import { markDownstreamStale, type StepIndex } from '@/engine/graph/stepGraph'
import {
  DEFAULT_SESSION_TITLE,
  type ContentRating,
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
import { DEFAULT_IMAGE_SETTINGS, type ImageSettings } from '@/types/settings'
import {
  DEFAULT_COMPOSER_STATE,
  loadComposerState,
  loadSceneImages,
  saveComposerState,
  saveSceneImages,
  type ComposerState,
} from './localSettings'

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

  /** 输入区那两个勾选（R18 模式 / 快速入戏）—— 导演可以替用户把它关掉 */
  composer: ComposerState
  /** 从别处往输入框里塞一段文字（比如导演推荐的方向） */
  draftInjection: { text: string; id: number } | null
  injectDraft: (text: string) => void
  setComposer: (patch: Partial<ComposerState>) => void

  setLlm: (patch: Partial<LlmSettings>) => void
  /** 生图模型配置 */
  image: ImageSettings
  setImage: (patch: Partial<ImageSettings>) => void
  /** 场面图：轮次 id → 图片地址。手动触发（或开着自动生图时自动跑），不属于流水线 */
  sceneImages: Record<string, string>
  setSceneImage: (roundId: string, url: string) => void
  /**
   * 当前吸顶的是哪一轮的场面卡（没有就是 null）。
   *
   * 界面背景由它决定：有吸顶的用它那张图；**一张都没吸顶**说明还停在
   * 第一段剧情之前，那时候用第一张卡片的图（只认第一张，不做回退）。
   */
  stuckRoundId: string | null
  setStuckRoundId: (roundId: string | null) => void
  /** 正在生图的轮次（生成中显示转圈，避免重复点） */
  sceneImageBusy: string | null
  setSceneImageBusy: (roundId: string | null) => void
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

  newRound: (userInput: string, rating?: ContentRating, idle?: boolean, direct?: boolean) => Round
  updateRoundInput: (roundId: string, userInput: string) => void
  /** 改某一轮的分级 */
  setRoundRating: (roundId: string, rating: ContentRating) => void
  /** 改某一轮的「快速入戏」（只在成人向那一轮有意义） */
  setRoundDirect: (roundId: string, direct: boolean) => void
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
  image: { ...DEFAULT_IMAGE_SETTINGS },
  sceneImages: typeof localStorage === 'undefined' ? {} : loadSceneImages(),
  sceneImageBusy: null,
  stuckRoundId: null,
  project: { ...DEFAULT_PROJECT_SETTINGS },
  // 初始化时就把上次的勾选读回来（测试 / SSR 环境没有 localStorage，退回默认）
  composer: typeof localStorage === 'undefined' ? { ...DEFAULT_COMPOSER_STATE } : loadComposerState(),
  draftInjection: null,
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

  injectDraft: (text) =>
    set({ draftInjection: { text, id: Date.now() + Math.random() } }),

  setComposer: (patch) => {
    const next = { ...get().composer, ...patch }
    saveComposerState(next)
    set({ composer: next })
  },

  setLlm: (patch) => set((state) => ({ llm: { ...state.llm, ...patch } })),
  setImage: (patch) => set((state) => ({ image: { ...state.image, ...patch } })),
  setSceneImage: (roundId, url) => {
    const next = { ...get().sceneImages, [roundId]: url }
    saveSceneImages(next)
    set({ sceneImages: next })
  },
  setStuckRoundId: (roundId) => set({ stuckRoundId: roundId }),
  setSceneImageBusy: (roundId) => set({ sceneImageBusy: roundId }),
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

  newRound: (userInput, rating = 'general', idle = false, direct = false) => {
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
      idle: idle || undefined,
      rating,
      direct: direct || undefined,
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

  setRoundDirect: (roundId, direct) =>
    set((state) => ({
      rounds: state.rounds.map((round) =>
        round.id === roundId ? { ...round, direct: direct || undefined, updatedAt: nowIso() } : round,
      ),
    })),

  setRoundRating: (roundId, rating) =>
    set((state) => ({
      rounds: state.rounds.map((round) =>
        round.id === roundId
          ? { ...round, rating, direct: rating === 'r18' ? round.direct : undefined, updatedAt: nowIso() }
          : round,
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
