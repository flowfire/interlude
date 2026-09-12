import { z } from 'zod'

export type CueChannel = 'face' | 'voice' | 'body' | 'pause' | 'gaze' | 'posture' | 'object' | 'breath'

export const CHANNEL_LABEL: Record<CueChannel, string> = {
  face: '表情',
  voice: '语气',
  body: '身体',
  pause: '停顿',
  gaze: '目光',
  posture: '姿态',
  object: '手里的东西',
  breath: '呼吸',
}

/**
 * 一条「外化线索」：你心里的状态，在别人眼里长什么样。
 *
 * 这是整个项目里「心理不外传、但允许被观察到」这条规则的落点。
 */
export interface PcCue {
  id: string
  /** 你心里的真实状态 —— 只有你和引擎知道，绝不派发给任何角色 AI */
  hidden: string
  /** 别人眼里看到的：只写现象，不写解释 */
  visible: string
  channel: CueChannel
  /** 泄漏程度 0~1：你这个人有多藏不住事 */
  leakage: number
  /** 可读性 0~1：别人把这条线索读成你真实心理的概率 */
  readability: number
  /** 这条线索来自第几条内心活动（按原文顺序从 0 开始），用于把它插回原位置 */
  fromIndex: number
}

/**
 * 派发给角色 AI 的版本：**只有现象**。
 * 注意这里没有 hidden 字段 —— 你的真实内心绝不出现在任何角色的上下文里。
 */
export interface ObservedCue {
  visible: string
  readability: number
  channel: CueChannel
  /** 来自第几条内心（按原文顺序），用于把它插回正确的时间位置 */
  fromIndex: number
  /** 泄漏程度 —— 观察者能感觉到「这人藏得深不深」 */
  leakage: number
}

export interface PcExposure {
  cues: PcCue[]
  /** 一句总述，例如「他努力维持着平常的样子，但熟悉他的人能看出一点不自在」 */
  note: string
  /** 这一轮你有没有写内心活动 */
  hadInner: boolean
  usedModel: boolean
  fallbackReason?: string
}

const looseNumber = z.union([z.number(), z.string()]).optional()

export const RawExposureSchema = z.object({
  cues: z.array(z.unknown()).optional(),
  note: z.union([z.string(), z.number(), z.null()]).optional(),
})

export type RawExposure = z.infer<typeof RawExposureSchema>
