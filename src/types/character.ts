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
  /**
   * 他读取他人内心的能力描述（没有就留空字符串）。
   *
   * 刻意不做成布尔开关 —— 读心有无数种：
   * 「只能感觉出对方情绪」「能听到没说出口的碎片」「能像读剧本一样看到全部」。
   * 强度与限制由模型自由描述，**具体能读到多少也交给模型**结合
   * 「对方的隐藏程度」自行判断，而不是引擎硬编一个阈值。
   */
  mindReading: string
  persona: {
    summary: string
    /**
     * **他想要什么。**
     *
     * 这是驱动他行动的东西，不是性格描述 —— 性格决定他*怎么*做，
     * 它决定他*去做什么*。没有这一条，角色就只能对着用户的话做姿态，
     * 永远不会自己往前走。
     */
    drive: string
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
    /** 能力：他能做什么。超出这个范围的事，他不该做得到 */
    abilities: string[]
    /** 感知特长：他能察觉到别人察觉不到的东西 */
    perception: string[]
    /** 会牵引剧情的设定：体质、宿命、身份、被卷进的事 */
    hooks: string[]
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
  /** 会牵引剧情的设定，例如「天生招祸，走到哪儿哪儿出事」 */
  hooks?: string[]
}

/** 额外感知是通过哪条通道来的 */
export type PerceiveChannel = 'sight' | 'hearing' | 'smell' | 'touch' | 'intuition' | 'mind'

export const PERCEIVE_CHANNEL_LABEL: Record<PerceiveChannel, string> = {
  sight: '看到',
  hearing: '听到',
  smell: '闻到',
  touch: '触到',
  intuition: '直觉',
  mind: '读到念头',
}

/** 被分发的一条信息（引擎侧编号，供分发层引用） */
export interface PerceiveCandidateRecord {
  ref: number
  kind: 'speech' | 'action' | 'scene' | 'ambient' | 'cue' | 'inner' | 'event'
  text: string
  /** 谁说的 / 谁做的 */
  from?: string
}

/** 某一个角色在这一轮里对信息的接收情况 */
export interface PerceptionEntry {
  characterId: string
  name: string
  /** 明确**没接收到**的（背对着、走神、不在场） */
  missed: { ref: number; why: string }[]
  /** 接收到了但**走了样**的（只听见半句、被理解成别的） */
  distorted: { ref: number; as: string }[]
  /** 在这些信息之外，**额外**察觉到的（超常感官 / 读心） */
  extras: { text: string; channel: PerceiveChannel; certainty: number }[]
  note: string
}

/**
 * 「信息分发」的结果：把这一轮实际发生的事，转化成每个角色各自接收到的版本。
 *
 * 存在的理由有两条：
 * 1. 判断「他能接收到什么」和「扮演角色」不能是同一个调用 ——
 *    否则后者手里握着原文，说什么都约束不住。原文留在这一层，不外流。
 * 2. 判断「谁背对着谁」这类空间关系需要全局视角 ——
 *    所以一次调用分发给大家，而不是每个角色各判一次。
 *
 * 默认所有人接收到全部信息，分发层只报**偏差**（missed / distorted）——
 * 这样输出短，台词原文也不会被模型转述走样。
 */
export interface PerceptionOutcome {
  /** 这一轮被分发出去的信息 */
  candidates: PerceiveCandidateRecord[]
  entries: PerceptionEntry[]
  usedModel: boolean
  fallbackReason?: string
}

/** 角色感知到的一件事，按时间顺序排列 */
export interface PerceivedEvent {
  kind: 'speech' | 'action' | 'cue' | 'event'
  /** 谁说的 / 谁做的。`event` 没有人称 —— 它是世界自己发生的事 */
  from: string
  text: string
  /** 是不是他自己做的 */
  self: boolean
}

/**
 * 往事里的一轮。
 *
 * 只有「他当时实际接收到的」东西：pc 那一侧经信息分发层筛过，
 * 被判定为漏看 / 听岔的已经在这里被剔掉或改写了；他自己和其他角色
 * 当时在舞台上的言行也在里面（同一轮的 AI 之间是并发演出的，互相看不见，
 * 下一轮才成为既成事实，所以按「默认所有人都收到了」的协议一律给他）。
 */
export interface HistoryRound {
  index: number
  /**
   * 这一轮他**不在场**。
   *
   * 不在场的轮次只留一行「你不在这里」，内容一个字都不给 ——
   * 他没经历过的事，不该出现在他的记忆里。
   */
  absent?: boolean
  /** absent 时，这一串不在场一直持续到第几轮（用于合并成一行） */
  absentThrough?: number
  time: string
  place: string
  /** 当时的场面信息（与当前轮用同一套写法，才能逐字节对齐） */
  atmosphere: string
  /** 当时那个「局面」的判断 */
  pressure: string
  escalation: string
  /** 那一轮之前的空白期（时间跳跃补全） */
  interludeSummary: string
  interludeMine: string
  /** 当时「你对面的人」呈现出来的样子 */
  pcProfile: string
  /** 当时在场的人 */
  presentNames: string[]
  /** 他当时感知到的环境（场景、氛围、场外） */
  sceneLines: string[]
  /** 他当时感知到的事，按时间顺序 */
  events: PerceivedEvent[]
  /** 他当时心里在想什么（只有他知道） */
  inner: string
}

/** 派发给某一个角色 AI 的完整上下文。这是「点开看它收到了什么」的内容 */
export interface ContextBundle {
  characterId: string
  name: string
  card: CharacterCard
  /** 这是第几轮（往事里也用它编号，两边必须一致才能对上） */
  roundIndex: number
  pcName: string
  /** 对面的人（用户扮演的角色）呈现给你的样子 —— 只有看得见的部分 */
  counterpartProfile: string
  presentNames: string[]
  /**
   * 前几轮已经演过的内容（纯文本，给拆解 / 场面 / 阵容三个阶段消歧用，
   * 它们不区分视角，所以这里不按角色过滤）。
   */
  recap: string
  /**
   * 他亲身经历的往事，**一轮一段，按时间顺序无限累加**。
   *
   * 这是「同一个角色跨轮次命中前缀缓存」的关键：第 K 轮的提示词里
   * 第 1..K-1 轮的段落，与第 K+1 轮一模一样，只是末尾多了一段。
   * 所以这里必须是结构化、且只依赖**那一轮已经固定的步骤**——
   * 重放时逐字节可复现，绝不因为后来发生的事而改写。
   */
  history: HistoryRound[]
  /**
   * 导演对他的点名（只在僵局时出现）。
   *
   * `push` 是为什么现在必须动；`act` 是导演指定的剧情动作（「他动手了」）。
   * 到「做了什么」为止 —— 怎么说、什么表情、什么节奏，仍然是这个角色自己的事。
   */
  nudge?: { push: string; act?: string }
  /**
   * 时间跳跃期间发生了什么。
   *
   * `summary` 是所有人都知道的那层；`mine` 只属于他自己。
   * 主角不在场的空白不是冻结的 —— 别人照样在过日子。
   */
  interlude?: { summary: string; mine?: string }
  /** 这一轮的局面：正在逼近什么（世界自己的判断，所有角色都看得到） */
  pressure: string
  /** 如果没有任何人干预，接下去会发生什么 */
  escalation: string
  /**
   * 这一轮的场面。
   * 只保留客观环境（时间地点氛围）—— 「此刻正在发生什么」和开场画面都走信息分发，
   * 因为它们可能包含某个角色看不见的东西。
   */
  scene: {
    time: string
    place: string
    atmosphere: string
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
  /**
   * 他**额外**察觉到的东西 —— 由「感知判定」阶段独立给出。
   *
   * 「额外」的意思是：明面上的台词和动作不在这里（那些直接给他），
   * 这里是他超出常人范围感知到的部分。别人的原始内心也不在这里 ——
   * 原文留在判定阶段，不会进他的上下文。
   */
  extras: { text: string; channel: PerceiveChannel; certainty: number }[]
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
  kind: 'scene' | 'world' | 'pc-action' | 'pc-speech' | 'pc-cue' | 'action' | 'speech' | 'cue'
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
  world: '局面',
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
