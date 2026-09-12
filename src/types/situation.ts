import { z } from 'zod'

/** 局面事件的两种气质：场景（看得见的东西）/ 氛围（声音、气味、变化） */
export type SituationEventKind = 'scene' | 'ambient'

export interface SituationEvent {
  kind: SituationEventKind
  text: string
}

/**
 * 僵局时，导演点名某个角色，让他这一轮动起来。
 *
 * 导演**通读台本**，和演员有同样的权限 —— 他可以决定某个角色这一轮做了什么
 * （「金刚狼动手了」）。这是剧情层面的指令，不是替他写台词：
 * 被点名的人收到指令后，由他自己演出细节 —— 怎么动、说什么、什么节奏。
 *
 * 用户扮演的角色永远不会出现在这里：用户写什么就是什么，谁也不能替他动。
 */
export interface SituationNudge {
  /** 被点名的角色（必须是在场的人） */
  who: string
  /** 为什么现在必须动（砸在他的目标或处境上） */
  push: string
  /**
   * 导演指定的剧情动作，例如「他动了 —— 第一头狼刚扑上来就被他按进了泥里」。
   *
   * 只在僵局时给。它到「剧情」这一层为止：做了什么，而不是怎么演、说什么。
   */
  act?: string
}

export const SITUATION_EVENT_LABEL: Record<SituationEventKind, string> = {
  scene: '眼前',
  ambient: '动静',
}

/**
 * 这一轮在节奏上的位置。
 *
 * 角色只会对眼前的事做反应，没有人推，他们就会一直聊下去 ——
 * 所以「这一轮该快还是该慢」是导演的活，不能交给角色的长期目标。
 */
export type SituationPace = 'build' | 'escalate' | 'climax' | 'settle'

export const SITUATION_PACE_LABEL: Record<SituationPace, string> = {
  build: '铺垫',
  escalate: '升温',
  climax: '爆发',
  settle: '收束',
}

/**
 * 「局面」——这一轮世界自己往前走了多少。
 *
 * 这是整条流水线里唯一一个**不代表任何角色**的行动者：
 * 狼群会不会扑上来、火塘会不会塌、对方会不会失去耐心，
 * 都不该等用户写出来才发生。
 */
export interface SituationState {
  /** 此刻的局势：正在逼近什么，代价是什么 */
  pressure: string
  /** 如果没有任何人干预，接下来会发生什么 */
  escalation: string
  /** 这一轮在节奏上的位置 */
  pace: SituationPace
  /** 僵局时点名的角色（通常为空） */
  nudges: SituationNudge[]
  /** 这一轮客观发生的事，按顺序（会进时间线，也会进信息分发） */
  events: SituationEvent[]
  /**
   * 这一轮**谁先动、谁后动**。
   *
   * 同一轮里角色是逐个演绎的，后开口的人看得见先开口的人说了什么 ——
   * 而先后由「局面」决定：它盯着此刻的局势，知道谁最可能先做出反应。
   */
  order: string[]
  note?: string
  usedModel: boolean
  fallbackReason?: string
}

export const RawSituationSchema = z.object({
  pace: z.union([z.string(), z.number(), z.null()]).optional(),
  pressure: z.union([z.string(), z.number(), z.null()]).optional(),
  escalation: z.union([z.string(), z.number(), z.null()]).optional(),
  events: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  order: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  nudges: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.number(), z.null()]).optional(),
})
