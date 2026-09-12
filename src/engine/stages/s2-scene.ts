import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import {
  RawSceneSetupSchema,
  type RawSceneSetup,
  type SceneBeat,
  type SceneInputMode,
  type ScenePresent,
  type SceneSetup,
} from '@/types/scene'
import type { EntityMention, Segment } from '@/types/segment'
import type { ContentRating } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'
import { asArray, asRecord, asText } from '@/utils/record'
import { buildSceneMessages } from '../prompts/scene'
import type { NormalizedDoc } from './s0-normalize'

export interface SceneStageInput {
  doc: NormalizedDoc
  segments: Segment[]
  /** 拆解阶段标出来的实体 —— 概要式输入常常只在这里留下人名 */
  entities?: EntityMention[]
  project: ProjectSettings
  previousScene?: { place: string; situation: string; summary: string } | null
  /** 这一轮的分级 */
  rating?: ContentRating
}

const INPUT_MODES: SceneInputMode[] = ['dialogue', 'outline', 'mixed']

function normalizeInputMode(input: unknown): SceneInputMode {
  const text = String(input ?? '').trim().toLowerCase()
  if (['outline', '概要', '概述', 'summary'].includes(text)) return 'outline'
  if (['mixed', '混合'].includes(text)) return 'mixed'
  if (['dialogue', '演出', '具体', '对话'].includes(text)) return 'dialogue'
  if (INPUT_MODES.includes(text as SceneInputMode)) return text as SceneInputMode
  return 'dialogue'
}

function normalizeBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input
  if (typeof input === 'number') return input !== 0
  const text = String(input ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1', '是', '需要', '在场'].includes(text)) return true
  if (['false', 'no', 'n', '0', '否', '不需要', '背景'].includes(text)) return false
  return fallback
}

function toStringArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof input === 'string' && input.trim()) {
    return input
      .split(/\n+/)
      .map((item) => item.replace(/^[·\-*]\s*/, '').trim())
      .filter(Boolean)
  }
  return []
}

/**
 * 从拆解结果里用规则抓人名，作为「绝不允许漏掉在场者」的保险。
 *
 * 三个来源都要看：
 * - 说话人
 * - 动作主体
 * - 拆解阶段标出来的实体表 —— 「我遇到了金刚狼」这种概要式输入
 *   往往既没有说话人也没有动作主体，名字只留在实体表里
 */
export function extractNamesFromSegments(
  segments: Segment[],
  pcName: string,
  entities: EntityMention[] = [],
): string[] {
  const names = new Set<string>()

  for (const segment of segments) {
    if (segment.speaker && segment.speaker !== pcName) names.add(segment.speaker.trim())
    for (const subject of segment.subject ?? []) {
      if (subject && subject !== pcName) names.add(subject.trim())
    }
  }

  for (const entity of entities) {
    if (entity.kind !== 'person') continue
    if (entity.mention === pcName) continue
    // 「只是被提到」的人不进在场名单，否则会把不在场的人硬拉进来
    if (entity.role === 'mentioned') continue
    names.add(entity.mention.trim())
  }

  return [...names].filter((name) => {
    if (!name || name.length > 8) return false
    return /^[\u4e00-\u9fa5A-Za-z·\s]+$/.test(name)
  })
}

/**
 * 保险丝：如果模型判定「没有需要单独反应的角色」，但素材里明明有人，
 * 就把素材里出现的人补进在场名单。概要式输入（「我遇到了金刚狼」）最容易踩这个坑。
 */
export function ensurePresentHasActors(
  present: ScenePresent[],
  segments: Segment[],
  pcName: string,
  entities: EntityMention[] = [],
): ScenePresent[] {
  const hasActor = present.some((item) => item.active && item.kind === 'character' && item.name !== pcName)
  if (hasActor) return present

  // 已经列出来但被标成「只是背景」的，先把他们提升为参与者
  const merged = present
    .filter((item) => item.name !== pcName)
    .map((item) => (item.kind === 'character' ? { ...item, active: true } : item))

  for (const name of extractNamesFromSegments(segments, pcName, entities)) {
    const existing = merged.find((item) => item.name === name)
    if (existing) {
      existing.active = true
      existing.kind = 'character'
      continue
    }
    merged.push({
      name,
      role: '（素材里出现的人）',
      brief: '（素材里没有更多描写）',
      kind: 'character',
      active: true,
    })
  }
  return merged
}

export function normalizeSceneSetup(raw: RawSceneSetup, pcName: string): Omit<SceneSetup, 'usedModel' | 'fallbackReason'> {
  const present: ScenePresent[] = []
  const seen = new Set<string>()

  for (const item of asArray(raw.present)) {
    const record = asRecord(item)
    if (!record) continue
    const name = String(record.name ?? '').trim()
    if (!name || name === pcName || seen.has(name)) continue
    seen.add(name)
    const kindRaw = String(record.kind ?? '').trim().toLowerCase()
    const kind: ScenePresent['kind'] = ['extra', '路人', 'bystander', 'background'].includes(kindRaw) ? 'extra' : 'character'
    present.push({
      name,
      role: String(record.role ?? '').trim(),
      brief: String(record.brief ?? '').trim(),
      kind,
      active: normalizeBool(record.active, kind === 'character'),
    })
  }

  const establishedBeats: SceneBeat[] = []
  for (const entry of asArray(raw.establishedBeats)) {
    const record = asRecord(entry)
    if (!record) continue
    const text = asText(record.text)
    if (!text) continue
    const kindRaw = asText(record.kind).toLowerCase()
    const kind: SceneBeat['kind'] = ['speech', '台词', '对话'].includes(kindRaw)
      ? 'speech'
      : ['scene', '场景', '环境'].includes(kindRaw)
        ? 'scene'
        : 'action'
    const character = asText(record.character)
    establishedBeats.push(character ? { kind, text, character } : { kind, text })
  }

  return {
    inputMode: normalizeInputMode(raw.inputMode),
    time: String(raw.time ?? '').trim(),
    place: String(raw.place ?? '').trim(),
    atmosphere: String(raw.atmosphere ?? '').trim(),
    opening: toStringArray(raw.opening),
    situation: String(raw.situation ?? '').trim(),
    pcProfile: String(raw.pcProfile ?? '').trim(),
    present,
    establishedBeats,
    timeSkip: raw.timeSkip ? String(raw.timeSkip).trim() : undefined,
  }
}

/** 模型不可用时的降级：素材写到哪算哪，不编造场面 */
export function buildSceneFromRules(
  doc: NormalizedDoc,
  segments: Segment[],
  project: ProjectSettings,
  fallbackReason: string,
  entities: EntityMention[] = [],
): SceneSetup {
  const opening = segments
    .filter((segment) => ['scene', 'ambient', 'narration'].includes(segment.kind))
    .map((segment) => segment.text)

  const establishedBeats: SceneBeat[] = segments
    .filter((segment) => segment.kind === 'speech' || segment.kind === 'action')
    .map((segment) => ({
      kind: segment.kind === 'speech' ? ('speech' as const) : ('action' as const),
      character: segment.speaker ?? segment.subject?.[0],
      text: segment.text,
    }))

  const present: ScenePresent[] = extractNamesFromSegments(segments, project.pcName, entities).map((name) => ({
    name,
    role: '（从素材推断）',
    brief: '（素材里没有更多描写）',
    kind: 'character',
    active: true,
  }))

  const hasDialogue = segments.some((segment) => segment.kind === 'speech')

  return {
    inputMode: hasDialogue ? 'dialogue' : 'outline',
    time: '',
    place: '',
    atmosphere: '',
    opening,
    situation: '',
    pcProfile: project.pcPersona.trim() || '（未说明）',
    present,
    establishedBeats,
    usedModel: false,
    fallbackReason,
  }
}

export async function runSceneStage(
  client: LlmClient,
  input: SceneStageInput,
): Promise<{ output: SceneSetup; result: ChatResult | null }> {
  const { doc, segments, project, previousScene, rating = 'general', entities = [] } = input

  const messages = buildSceneMessages({
    doc,
    segments,
    pcName: project.pcName,
    pcPersona: project.pcPersona,
    storyTitle: project.storyTitle,
    previousScene,
    rating,
  })

  try {
    const { data, result } = await client.chatJson<RawSceneSetup>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: 'scene',
      // 场景构建需要一点想象力（补环境、补路人），但结构必须稳
      parse: (raw) => RawSceneSetupSchema.parse(raw),
    })

    const normalized = normalizeSceneSetup(data, project.pcName)
    const present = ensurePresentHasActors(normalized.present, segments, project.pcName, entities)

    return {
      output: { ...normalized, present, usedModel: true },
      result,
    }
  } catch (error) {
    return {
      output: buildSceneFromRules(
        doc,
        segments,
        project,
        error instanceof Error ? error.message : String(error),
        entities,
      ),
      result: null,
    }
  }
}
