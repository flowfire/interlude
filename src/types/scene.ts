import { z } from 'zod'

/** 用户这一轮写的是具体演出，还是只有一句概要 */
export type SceneInputMode = 'dialogue' | 'outline' | 'mixed'

export interface ScenePresent {
  name: string
  /** 他在这个场面里的位置/身份，例如「柜台后的老板」 */
  role: string
  /** 他此刻在做什么 */
  brief: string
  /** character = 要建卡的角色；extra = 临时路人 */
  kind: 'character' | 'extra'
  /** 是否需要单独生成反应；false 表示只作为背景 */
  active: boolean
}

export interface SceneBeat {
  kind: 'scene' | 'action' | 'speech'
  character?: string
  text: string
}

/**
 * S2 场景构建的产物。
 *
 * 它的职责是把「（我遇到了金刚狼）」这种概要，展开成一个可以立刻开演的场面：
 * 什么地方、什么时候、什么氛围、此刻正在发生什么、有哪些人在场。
 */
/**
 * 时间跳跃期间发生了什么。
 *
 * 用户写「三天后」时，这三天是空白的 —— 而角色是活人，他们在这三天里
 * 各自过了日子。补全就是把这层空白填上：主角回来时，世界不是原地冻结的。
 */
export interface SceneInterlude {
  /** 这段时间里场面/世界上发生的事（所有人都知道） */
  summary: string
  /** 每个人各自经历了什么（各自只看到自己那条） */
  each: { who: string; what: string }[]
}

export interface SceneSetup {
  inputMode: SceneInputMode
  /** 绝对或相对时间描述，例如「三天后的傍晚」 */
  time: string
  place: string
  atmosphere: string
  /** 开场画面：2~4 句具体的环境描写，像电影第一个镜头 */
  opening: string[]
  /** 一句话：此刻正在发生什么 */
  situation: string
  /** 从素材与用户自我设定里归纳出的「你」呈现给别人的样子 */
  pcProfile: string
  present: ScenePresent[]
  /** 素材里已经明确发生的事，按顺序 */
  establishedBeats: SceneBeat[]
  /** 本轮的时间跳跃描述（如果有） */
  timeSkip?: string
  /** 时间跳跃期间发生了什么（只有真的跳了、且开关打开时才有） */
  interlude?: SceneInterlude
  /**
   * 这一轮的场景**没有变**（还是那个地方、那段时间、那些人）。
   *
   * 连续几轮待在同一处时，场景构建那一步只需要判一句"没变"就行 ——
   * 不必重新描写一遍环境。引擎会把上一轮那份原样沿用，
   * 页面上也不会插入新的场面条（sticky 的上一条会继续吸着）。
   */
  unchanged?: boolean
  usedModel: boolean
  fallbackReason?: string
}

export const SCENE_MODE_LABEL: Record<SceneInputMode, string> = {
  dialogue: '具体演出',
  outline: '概要展开',
  mixed: '演出 + 概要',
}

const looseText = z.union([z.string(), z.number(), z.null()]).optional()
/** 只保证「是个数组」—— 元素长什么样交给归一化去清理，别让一个脏元素毁掉整步 */
const looseArray = z.union([z.array(z.unknown()), z.string(), z.null()]).optional()

export const RawSceneSetupSchema = z.object({
  inputMode: looseText,
  time: looseText,
  place: looseText,
  atmosphere: looseText,
  opening: looseArray,
  situation: looseText,
  pcProfile: looseText,
  timeSkip: looseText,
  interlude: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
  present: looseArray,
  establishedBeats: looseArray,
  unchanged: z.union([z.boolean(), z.string(), z.null()]).optional(),
})

export type RawSceneSetup = z.infer<typeof RawSceneSetupSchema>
