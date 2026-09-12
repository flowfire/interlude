import { z } from 'zod'
import type { ObservedCue } from './exposure'
import type { MemoryEntry } from './memory'

export type CastTier = 'pc' | 'major' | 'minor' | 'extra'

export const TIER_LABEL: Record<CastTier, string> = {
  pc: '你',
  major: '主要',
  minor: '次要',
  extra: '路人',
}

export type CardTier = CastTier

/** 人设资料的来源 */
export type CardSource = 'wiki' | 'model' | 'material' | 'manual'

export const SOURCE_LABEL: Record<CardSource, string> = {
  wiki: '维基资料',
  model: '模型知识',
  material: '仅素材',
  manual: '手工编辑',
}

/** 一个角色的设定卡 */
export interface CharacterCard {
  id: string
  name: string
  aliases: string[]
  tier: CastTier
  origin: 'generated' | 'manual'
  /** 是否是已有作品里 / 现实中的知名角色 */
  canonical: boolean
  /** 出自哪部作品；原创角色留空 */
  franchise: string
  /** 人设主要依据 */
  source: CardSource
  /** 查到的资料摘要（可追溯，也避免重跑时再查一次） */
  researchNote?: string
  persona: {
    summary: string
    speechStyle: string
    temperament: string[]
    habits: string[]
    background: string
    /** 标志性特征：具体到能被人一眼认出来的行为、习惯、外观细节 */
    signature: string[]
    /** 符合他说话方式的示例台词 —— 用来把握语气，不是必须说的台词 */
    voiceSamples: string[]
    /** 原作 / 设定里确定的事实：经历、关系、能力与限制 */
    canonAnchors: string[]
    /** 他绝不会做的事、绝不会说的话 */
    boundaries: string[]
  }
  state: {
    mood: string
    location: string
  }
  /** 是否在这一轮素材里实际出场（说了话或做了动作）；只是被提到的为 false */
  appearsInInput: boolean
  /** 依据：素材里的哪一句让你这么判断 */
  evidence: string
}

/** 已经出场过的角色，用来解析「他」「前面那个人」这类指代 */
export interface KnownCastEntry {
  name: string
  aliases: string[]
  brief: string
}

/** 角色感知到的一件事，按时间顺序排列 */
export interface PerceivedEvent {
  kind: 'speech' | 'action' | 'cue'
  /** 谁说的 / 谁做的 */
  from: string
  text: string
  /** 是不是他自己做的 */
  self: boolean
}

/** 派发给某一个角色 AI 的完整上下文。这是「点开看它收到了什么」的内容 */
export interface ContextBundle {
  characterId: string
  name: string
  card: CharacterCard
  pcName: string
  /** 对面的人（用户扮演的角色）呈现给你的样子 —— 只有看得见的部分 */
  counterpartProfile: string
  presentNames: string[]
  /** 这一轮的场面设定 */
  scene: {
    time: string
    place: string
    atmosphere: string
    situation: string
    opening: string[]
  }
  /**
   * 按时间顺序发生的事。
   * 这是给角色看的主要依据 —— 用户是按顺序写的，角色也该按顺序感知。
   */
  perceived: PerceivedEvent[]
  /** 环境：场景、氛围、场外、设定 */
  sceneLines: string[]
  /** 他亲耳听到的台词（不含他自己说的） */
  heard: { from: string; text: string }[]
  /** 他看到的别人的动作（不含他自己的） */
  seen: { subject: string; text: string }[]
  /** 他自己的心理活动（如果素材里写了） */
  ownThoughts: string[]
  /** 素材里已经属于他的表现：他刚才说过什么、做过什么 */
  ownPriorLines: string[]
  /** 他注意到的、从「你」的内心外化出来的可见表现 —— 只有现象，没有你的真实想法 */
  pcCues: ObservedCue[]
  /** 他记得的、以前轮次发生过的事（按时间顺序，最近的排在最后） */
  recalled: MemoryEntry[]
  /** 被提及的背景事实 */
  knownFacts: string[]
  /** 硬约束：他确定不知道的事 */
  doesNotKnow: string[]
}

/** 角色产出的一个节拍 */
export interface Beat {
  kind: 'speech' | 'action' | 'cue'
  text: string
  addressee?: string[]
}

export interface RoleplayOutput {
  characterId: string
  name: string
  beats: Beat[]
  /** 内心活动：只存档，绝不派发给其他角色 */
  inner?: string
  mood?: string
  /** 如果这一轮没有说话，说明为什么（沉默也是反应） */
  silentReason?: string
}

/** 主看板上的一张角色反应卡 */
export interface ReactionCard {
  characterId: string
  name: string
  tier: CastTier
  beats: Beat[]
  inner?: string
  mood?: string
  silentReason?: string
}

export interface SceneBlock {
  order: number
  kind: 'scene' | 'pc-action' | 'pc-speech' | 'pc-cue' | 'action' | 'speech' | 'cue'
  characterId?: string
  characterName?: string
  text: string
  /** 你写的既定内容，不可改写 */
  locked?: boolean
}

/** S7 编排出来的这一幕 */
export interface ComposedScene {
  blocks: SceneBlock[]
  reactions: ReactionCard[]
  pcName: string
}

export const BLOCK_KIND_LABEL: Record<SceneBlock['kind'], string> = {
  scene: '场景',
  'pc-action': '你的动作',
  'pc-speech': '你的台词',
  'pc-cue': '你的流露',
  action: '动作',
  speech: '台词',
  cue: '可见线索',
}

/* ---------------- 模型原始输出的宽松 schema ---------------- */

const looseString = z.union([z.string(), z.number(), z.null()]).optional()
const looseStringArray = z.union([z.array(z.union([z.string(), z.number()])), z.string(), z.null()]).optional()
const looseBool = z.union([z.boolean(), z.string(), z.number()]).optional()

/** 同样只保证「是个数组」，元素交给归一化清理 */
export const RawCastResultSchema = z.object({
  characters: z.array(z.unknown()).optional(),
})

export type RawCastResult = z.infer<typeof RawCastResultSchema>

export const RawRoleplaySchema = z.object({
  beats: z.array(z.unknown()).optional(),
  inner: looseString,
  mood: looseString,
  silentReason: looseString,
})

export type RawRoleplay = z.infer<typeof RawRoleplaySchema>
