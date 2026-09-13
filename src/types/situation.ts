import { z } from 'zod'

/** 局面事件的两种气质：场景（看得见的东西）/ 氛围（声音、气味、变化） */
export type SituationEventKind = 'scene' | 'ambient'

export interface SituationEvent {
  kind: SituationEventKind
  text: string
}

/**
 * 导演交给某一个角色的**这一轮的任务**。
 *
 * 这是这一场戏的层级决定的：用户只提出「点」，导演负责把整场戏安排出来，
 * 角色只负责按人设把分到的那部分演出来。
 *
 * 所以导演每一轮都可以派任务，不限于僵局 —— 僵局只是它**必须**派任务的情形。
 * 这是剧情层面的指令（「他动手了」），不是替他写台词：
 * 接到任务的人自己决定怎么说、什么表情、什么节奏。
 *
 * 用户扮演的角色永远不会出现在这里：用户写什么就是什么，谁也不能替他动。
 */
export interface SituationDirection {
  /** 被点名的角色（必须是在场的人） */
  who: string
  /** 为什么这一轮该他做这件事（砸在他的目标或处境上） */
  push: string
  /**
   * 导演指定的剧情动作，例如「他动了 —— 第一头狼刚扑上来就被他按进了泥里」。
   *
   * 它到「剧情」这一层为止：做了什么，而不是怎么演、说什么。
   */
  act?: string
  /**
   * 这一轮**不要跟用户交互**。
   *
   * 角色不知道用户在等，所以会本能地每轮都回头找他。当眼前有必须处理的事时，
   * 导演要明确把这条说出来：你的首要任务是眼前这个情形，别回头跟他说话、
   * 别指挥他、别确认他的状态。
   */
  noInteract?: boolean
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
  /**
   * 交代「他们为什么在一起了」的那段背景。
   *
   * 快速模式下用户把**感情建立**这段委托给导演了 —— 但他要看，所以
   * 这一段必须真的写出来，而且要够：**用户嫌的不是长，是空。**
   * 平时（没勾快速模式）可以留空。
   */
  backstory: string
  /**
   * 为什么是**此刻**。
   *
   * 成人向推进时导演必须先交代这个：这个理由得建立在这一轮之前
   * **已经发生过的事**上，而不是"他们彼此吸引，终于忍不住了"这种
   * 放在哪一轮都成立的空话。找不到理由，就说明前面该铺的没铺，
   * 这一轮要先把那个契机补上。
   */
  reason: string
  /**
   * 这一轮**没有往前走**的缘由。
   *
   * 导演每一轮都要自问"比上一轮更进一步了吗"。推进了就留空；
   * 没推进就必须写清楚卡在哪 —— 而且必须是当下的、具体的理由。
   * 写"时机未到""还在酝酿"等于承认自己不知道该往哪走。
   */
  holdUp: string
  /** 成人向已经连着几轮了 —— 就是压在导演身上的那个数字，页面上会显示 */
  r18Streak: number
  /**
   * 导演给自己这一轮打的「性内容分」。
   *
   * 0 = 完全没有性内容，也没有往那去的倾向；50 = 有实质的身体接触；
   * 100 = 已经在做爱；100 以上不再是程度而是进度 —— 从第一次做爱那轮算起，
   * 每多一轮 +10（110、120……）。
   *
   * 填的是**这一轮结束时的分**。引擎会把最近几轮的分回传给它，
   * 它自己就能看出"我磨了三轮"——比外部命令更管用。
   */
  sexScore: number
  /**
   * 上一轮的 sexScore（**引擎填的，不是导演给的**）。
   *
   * 快速模式有条硬规则：这一轮的分必须比上一轮高，否则视为不合格。
   * 判断放在界面上做，所以这里只存数据。
   */
  prevSexScore: number
  /**
   * 导演推荐的发展方向。
   *
   * 有些场面确实没法直接进入性（刚见面、身份对立、正在危险里）。
   * 这时候导演**不许硬拗**（会跳戏）、**也不许交一份跟这个开关无关的正常剧情**
   * （那是抗命），而是停下来问用户：我推不动，这儿有几条路，你挑一条。
   *
   * 用户点一下就等于把那段话填进输入框 —— 选择权始终在他手里，
   * 导演只是把"可以怎么开场"摆出来。
   */
  routes: { title: string; detail: string }[]
  /** 这一轮在节奏上的位置 */
  pace: SituationPace
  /**
   * 这一幕的成人向内容已经收尾。
   *
   * 导演有权踩刹车：性这件事有始有终，写完了就该回到别的方向去。
   * 客户端看到它会**自动取消 R18 勾选**（用户随时可以再勾回来），
   * 免得一路挂着陷入没完没了的成人向。
   */
  r18Ended: boolean
  /**
   * 导演给每个角色的这一轮任务。
   *
   * 不是"僵局才点名" —— 导演每一轮都在安排这一场戏，这里是他安排的结果。
   * 没有要特别指派的时候可以是空数组。
   */
  directions: SituationDirection[]
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
  backstory: z.union([z.string(), z.number(), z.null()]).optional(),
  reason: z.union([z.string(), z.number(), z.null()]).optional(),
  sexScore: z.union([z.number(), z.string(), z.null()]).optional(),
  holdUp: z.union([z.string(), z.number(), z.null()]).optional(),
  routes: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  pace: z.union([z.string(), z.number(), z.null()]).optional(),
  r18Ended: z.union([z.boolean(), z.string(), z.null()]).optional(),
  pressure: z.union([z.string(), z.number(), z.null()]).optional(),
  escalation: z.union([z.string(), z.number(), z.null()]).optional(),
  events: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  order: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  directions: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.number(), z.null()]).optional(),
})
