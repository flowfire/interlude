/** 流水线阶段 */
export type StepStage =
  | 'normalize'
  | 'segment'
  | 'scene'
  | 'exposure'
  | 'cast'
  | 'perceive'
  | 'context'
  | 'roleplay'
  | 'exteriorize'
  | 'compose'
  | 'commit'

export const STAGE_LABEL: Record<StepStage, string> = {
  normalize: '规范化',
  segment: '拆解',
  scene: '场景构建',
  exposure: '你的外化',
  cast: '阵容解析',
  perceive: '信息分发',
  context: '上下文分配',
  roleplay: '角色反应',
  exteriorize: '外化与失真',
  compose: '编排',
  commit: '状态回写',
}

export type StepStatus = 'pending' | 'running' | 'done' | 'stale' | 'error'

export interface StepCost {
  calls: number
  tokensIn: number
  tokensOut: number
  ms: number
}

/**
 * 一个可编辑、可重跑的步骤。
 * 用户编辑 output 后，所有下游 step 会被标为 stale，可选择性重跑。
 */
export interface Step<TOut = unknown> {
  id: string
  roundId: string
  stage: StepStage
  label: string
  /** 直接上游 stepId（DAG 边） */
  deps: string[]
  /** 跑这一步时实际喂给它的完整输入快照（用于「点开看它收到了什么」） */
  inputSnapshot: unknown
  output: TOut
  /** 步骤的附加参数，例如「这一步是给哪个角色组装上下文」 */
  meta?: Record<string, unknown>
  status: StepStatus
  /** 锁定后重跑会跳过它，直接复用其产物 */
  lockedByUser: boolean
  editedByUser: boolean
  error?: string
  model?: string
  cost?: StepCost
  createdAt: string
  updatedAt: string
}

/** 副作用账本：所有写入持久状态的东西都记录来源步骤，便于回退时精确撤销 */
export interface LedgerEntry {
  id: string
  roundId: string
  producedByStepId: string
  kind: 'memory' | 'relation' | 'timeline' | 'card' | 'state'
  targetId: string
  payload: unknown
  createdAt: string
}

/** 一个「对话」：一条独立的故事线，包含若干依次发生的轮次 */
export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export const DEFAULT_SESSION_TITLE = '新的对话'

/**
 * 内容分级。由你在**每次发送时单独选择**，跟着这一轮走。
 * general = 常规；r18 = 成人向倾向（角色能自己控制的那部分往这个方向走，但不能脱离人设）。
 */
export type ContentRating = 'general' | 'r18'

export const RATING_LABEL: Record<ContentRating, string> = {
  general: '常规',
  r18: 'R18',
}

export interface Round {
  id: string
  /** 属于哪一个对话 */
  sessionId: string
  /** 在所属对话内的序号，从 1 开始 */
  index: number
  /** 你这一轮输入的文字 */
  userInput: string
  /** 这一轮的分级（旧数据可能没有，按 general 处理） */
  rating?: ContentRating
  stepIds: string[]
  rootStepIds: string[]
  status: 'draft' | 'running' | 'done' | 'error'
  createdAt: string
  updatedAt: string
  error?: string
  note?: string
}

/** 步骤树上「从这一步重跑」的影响面 */
export interface RerunPlan {
  stepId: string
  /** 需要重新计算的步骤（拓扑序） */
  toRun: string[]
  /** 会被复用的步骤 */
  reused: string[]
  /** 会被撤销的账本条目 */
  revokedLedger: string[]
}
