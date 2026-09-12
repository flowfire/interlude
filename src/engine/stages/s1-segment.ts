import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import {
  RawSegmenterResultSchema,
  type EntityMention,
  type Segment,
  type SegmentKind,
  type SegmenterResult,
  type TimeMarker,
  type RawSegmenterResult,
} from '@/types/segment'
import type { ProjectSettings } from '@/types/settings'
import type { KnownCastEntry } from '@/types/character'
import { asArray, asRecord, asText, asTextArray } from '@/utils/record'
import { clamp } from '@/utils/time'
import { buildSegmenterMessages } from '../prompts/segmenter'
import type { NormalizedDoc, TextBlock } from './s0-normalize'

const KIND_SET = new Set<SegmentKind>([
  'scene',
  'action',
  'speech',
  'inner',
  'narration',
  'worldfact',
  'offscreen',
  'ambient',
  'unknown',
])

/** 模型可能回中文标签或别名，这里统一成枚举 */
const KIND_ALIAS: Record<string, SegmentKind> = {
  场景: 'scene',
  环境: 'scene',
  scenery: 'scene',
  setting: 'scene',
  动作: 'action',
  actin: 'action',
  behavior: 'action',
  台词: 'speech',
  对话: 'speech',
  dialogue: 'speech',
  心理: 'inner',
  内心: 'inner',
  thought: 'inner',
  monologue: 'inner',
  旁白: 'narration',
  叙述: 'narration',
  world: 'worldfact',
  设定: 'worldfact',
  fact: 'worldfact',
  场外: 'offscreen',
  offscreen_event: 'offscreen',
  群像: 'ambient',
  氛围: 'ambient',
}

export function normalizeKind(input: unknown): SegmentKind {
  const text = String(input ?? '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (KIND_SET.has(text as SegmentKind)) return text as SegmentKind
  return KIND_ALIAS[text] ?? KIND_ALIAS[String(input ?? '').trim()] ?? 'unknown'
}

function normalizeStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
  }
  if (typeof input === 'string' && input.trim()) {
    return input
      .split(/[、,，/\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeSpeaker(input: unknown, pcName: string): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (raw === '我' || raw === '自己' || raw === '本人' || raw === '主角') return pcName
  return raw
}

/**
 * 把模型输出的片段对齐回原文偏移。
 * 同一个文本块被拆成多段时，用游标顺序查找，避免重复命中同一位置。
 */
function alignRange(raw: string, block: TextBlock | undefined, cursors: Map<number, number>): [number, number] {
  if (!block) return [0, 0]
  const text = raw.trim()
  if (!text) return block.range

  const cursor = cursors.get(block.index) ?? 0
  let offset = block.text.indexOf(text, cursor)
  if (offset === -1) offset = block.text.indexOf(text)
  if (offset === -1) return block.range

  cursors.set(block.index, offset + text.length)
  return [block.range[0] + offset, block.range[0] + offset + text.length]
}

export interface NormalizedSegmentOutput {
  segments: Segment[]
  entities: EntityMention[]
  timeMarkers: TimeMarker[]
}

/** 把模型输出归一化成稳定的内部结构 */
export function normalizeSegmenterOutput(
  raw: RawSegmenterResult,
  doc: NormalizedDoc,
  pcName: string,
): NormalizedSegmentOutput {
  const byIndex = new Map<number, TextBlock>()
  for (const block of doc.blocks) byIndex.set(block.index, block)

  const cursors = new Map<number, number>()
  const segments: Segment[] = []

  asArray(raw.segments).forEach((entry, order) => {
    const item = asRecord(entry)
    if (!item) return

    const text = asText(item.text)
    if (!text) return

    const blockIndex = Number(item.blockIndex)
    const block = Number.isFinite(blockIndex) ? byIndex.get(blockIndex) : undefined
    const kind = normalizeKind(item.kind)
    const speaker = normalizeSpeaker(item.speaker, pcName)
    const confidenceRaw = Number(item.confidence)
    const confidence = Number.isFinite(confidenceRaw) ? clamp(confidenceRaw, 0, 1) : 0.6
    const visibility = kind === 'inner' ? 'private' : item.visibility === 'private' ? 'private' : 'public'
    const isPcSpeech = kind === 'speech' && speaker === pcName

    segments.push({
      id: `seg_${order}`,
      kind,
      text,
      speaker,
      addressee: asTextArray(item.addressee),
      subject: asTextArray(item.subject),
      location: item.location ? asText(item.location) || null : null,
      isFact: isPcSpeech,
      lockedByUser: false,
      visibility,
      confidence,
      sourceRange: alignRange(text, block, cursors),
      reason: item.reason ? asText(item.reason) || undefined : undefined,
      origin: 'model',
    })
  })

  const entities: EntityMention[] = asArray(raw.entities)
    .map((entry) => {
      const item = asRecord(entry)
      if (!item) return null
      const mention = asText(item.mention)
      if (!mention) return null
      const kindRaw = asText(item.kind).toLowerCase() || 'person'
      const roleRaw = asText(item.role).toLowerCase() || 'unknown'
      const kind = (['person', 'place', 'object', 'org', 'other'] as const).includes(kindRaw as never)
        ? (kindRaw as EntityMention['kind'])
        : 'other'
      const role = (['pc', 'present', 'mentioned', 'unknown'] as const).includes(roleRaw as never)
        ? (roleRaw as EntityMention['role'])
        : 'unknown'
      return { mention, kind, role } satisfies EntityMention
    })
    .filter((entity): entity is EntityMention => entity !== null)

  // 视角角色必须出现在实体表里，否则后续阵容解析会漏掉
  if (!entities.some((entity) => entity.mention === pcName)) {
    entities.unshift({ mention: pcName, kind: 'person', role: 'pc' })
  } else {
    for (const entity of entities) if (entity.mention === pcName) entity.role = 'pc'
  }

  const timeMarkers: TimeMarker[] = []
  for (const entry of asArray(raw.timeMarkers)) {
    const item = asRecord(entry)
    if (!item) continue
    const text = asText(item.text)
    if (!text) continue
    const kindRaw = asText(item.kind).toLowerCase() || 'unknown'
    const kind = (['absolute', 'relative', 'elapsed', 'unknown'] as const).includes(kindRaw as never)
      ? (kindRaw as TimeMarker['kind'])
      : 'unknown'
    const value = item.value ? asText(item.value) : ''
    timeMarkers.push(value ? { text, kind, value } : { text, kind })
  }

  return { segments, entities, timeMarkers }
}

/** 没有模型（或模型失败）时的降级结果：直接用规则预标注 */
export function buildSegmentsFromRules(doc: NormalizedDoc, pcName: string): NormalizedSegmentOutput {
  const segments: Segment[] = doc.blocks.map((block, order) => {
    const kind = block.ruleKind
    const speaker = kind === 'speech' ? normalizeSpeaker(block.ruleSpeaker, pcName) : null
    const isPcSpeech = kind === 'speech' && speaker === pcName
    return {
      id: `seg_${order}`,
      kind,
      text: block.text,
      speaker,
      addressee: block.ruleAddressee,
      subject: [],
      location: null,
      isFact: isPcSpeech,
      lockedByUser: false,
      visibility: kind === 'inner' ? 'private' : 'public',
      confidence: block.ruleConfidence,
      sourceRange: block.range,
      reason: block.ruleNotes.length ? `规则预标注：${block.ruleNotes.join('；')}` : '规则预标注',
      origin: 'rule',
    }
  })

  const entities: EntityMention[] = [{ mention: pcName, kind: 'person', role: 'pc' }]
  const timeMarkers: TimeMarker[] = doc.timeMarkerHits.map((hit) => ({
    text: hit.text,
    kind: 'unknown' as const,
  }))

  return { segments, entities, timeMarkers }
}

/* ---------------- 执行 S1 ---------------- */

export interface SegmentStageInput {
  doc: NormalizedDoc
  project: ProjectSettings
  /** 这个故事里已经出场过的人，用来解析「他」「前面那个人」这类指代 */
  knownCast?: KnownCastEntry[]
  /** 前面已经演过的剧情 */
  previousRecap?: string
}

export interface SegmentStageOutput extends SegmenterResult {
  /** 是否走了模型；false 表示用的规则降级结果 */
  usedModel: boolean
  fallbackReason?: string
}

export async function runSegmentStage(
  client: LlmClient,
  input: SegmentStageInput,
): Promise<{ output: SegmentStageOutput; result: ChatResult | null }> {
  const { doc, project } = input
  const messages = buildSegmenterMessages({
    doc,
    pcName: project.pcName,
    pcPersona: project.pcPersona,
    storyTitle: project.storyTitle,
    freedomLevel: project.freedomLevel,
    knownCast: input.knownCast,
    previousRecap: input.previousRecap,
  })

  try {
    const { data, result } = await client.chatJson<RawSegmenterResult>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: 'segment',
      parse: (raw) => RawSegmenterResultSchema.parse(raw),
    })

    const normalized = normalizeSegmenterOutput(data, doc, project.pcName)
    if (!normalized.segments.length) {
      const fallback = buildSegmentsFromRules(doc, project.pcName)
      return {
        output: { ...fallback, usedModel: false, fallbackReason: '模型没有返回任何片段' },
        result,
      }
    }
    return { output: { ...normalized, usedModel: true }, result }
  } catch (error) {
    const fallback = buildSegmentsFromRules(doc, project.pcName)
    return {
      output: {
        ...fallback,
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
