import { z } from 'zod'

/** 片段类型：拆解后每个最小单元的分类 */
export const SegmentKindSchema = z.enum([
  'scene', // 场景 / 环境描写
  'action', // 动作
  'speech', // 说出来的话
  'inner', // 心理活动（不外传）
  'narration', // 旁白 / 叙述
  'worldfact', // 世界设定 / 事实陈述
  'offscreen', // 场外事件（被提及但未演出）
  'ambient', // 氛围 / 群像
  'unknown', // 无法判定
])
export type SegmentKind = z.infer<typeof SegmentKindSchema>

export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  scene: '场景',
  action: '动作',
  speech: '台词',
  inner: '心理',
  narration: '旁白',
  worldfact: '设定',
  offscreen: '场外',
  ambient: '群像',
  unknown: '未定',
}

export const SEGMENT_KIND_HINT: Record<SegmentKind, string> = {
  scene: '环境、光线、天气、地点陈设。交给环境 Agent',
  action: '身体动作、走位、动手做的事。执行者与旁观者都会看到',
  speech: '真正说出口的话。收件人一定能听到',
  inner: '内心活动。默认不外传，只会外化成微表情 / 小动作线索',
  narration: '叙述性文字，不明确属于谁',
  worldfact: '世界观、设定、既定事实',
  offscreen: '发生在别处或别的时间、被提及的事件',
  ambient: '人群、嘈杂、背景动态',
  unknown: '引擎无法判定，等你指定',
}

/** 一个片段 */
export interface Segment {
  id: string
  kind: SegmentKind
  text: string
  /** speech 的说话人；等于 pcName 时表示你说的话 */
  speaker?: string | null
  /** speech 的接收者 */
  addressee?: string[]
  /** action / inner 的承载者 */
  subject?: string[]
  location?: string | null
  /** true = 锁定，AI 不可改写（默认仅你扮演角色的台词为 true） */
  isFact: boolean
  /** 是否由你手动锁定的 */
  lockedByUser: boolean
  visibility: 'public' | 'private'
  /** 0..1，低置信在 UI 高亮提示确认 */
  confidence: number
  /** 在你原文中的字符偏移，用于高亮 */
  sourceRange: [number, number]
  /** 引擎给出这个判定的理由（便于你校正） */
  reason?: string
  /** 来源：规则预标注还是模型判定 */
  origin: 'rule' | 'model'
}

export interface EntityMention {
  mention: string
  kind: 'person' | 'place' | 'object' | 'org' | 'other'
  role: 'pc' | 'present' | 'mentioned' | 'unknown'
}

export interface TimeMarker {
  text: string
  kind: 'absolute' | 'relative' | 'elapsed' | 'unknown'
  value?: string
}

export interface SegmenterResult {
  segments: Segment[]
  entities: EntityMention[]
  timeMarkers: TimeMarker[]
}

/* ---------------- LLM 原始输出的宽松 schema（拿到后再归一化） ---------------- */

const looseString = z.union([z.string(), z.number(), z.null()]).optional()
const looseStringArray = z.union([z.array(z.union([z.string(), z.number()])), z.string(), z.null()]).optional()

export const RawSegmentSchema = z.object({
  /** 来源文本块编号（引擎按块切分后交给模型打标签，保证能对齐回原文） */
  blockIndex: z.union([z.number(), z.string()]).optional(),
  kind: z.string().optional(),
  text: z.string(),
  speaker: looseString,
  addressee: looseStringArray,
  subject: looseStringArray,
  location: looseString,
  confidence: z.union([z.number(), z.string()]).optional(),
  visibility: z.string().optional(),
  reason: looseString,
})

export const RawSegmenterResultSchema = z.object({
  segments: z.array(RawSegmentSchema),
  entities: z
    .array(
      z.object({
        mention: z.string(),
        kind: z.string().optional(),
        role: z.string().optional(),
      }),
    )
    .optional(),
  timeMarkers: z
    .array(
      z.object({
        text: z.string(),
        kind: z.string().optional(),
        value: looseString,
      }),
    )
    .optional(),
})

export type RawSegmenterResult = z.infer<typeof RawSegmenterResultSchema>
