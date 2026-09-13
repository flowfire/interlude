import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import {
  RawSceneSetupSchema,
  type RawSceneSetup,
  type SceneBeat,
  type SceneInputMode,
  type SceneInterlude,
  type ScenePresent,
  type SceneSetup,
} from '@/types/scene'
import type { EntityMention, Segment } from '@/types/segment'
import type { KnownCastEntry } from '@/types/character'
import type { ContentRating } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'
import { resolveKnownName } from '@/engine/memory/library'
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
  /** 这个故事里已经出场过的人，用来解析「他」「前面那个人」这类指代 */
  knownCast?: KnownCastEntry[]
  /** 前面已经演过的剧情 */
  previousRecap?: string
  /** 时间跳跃时是否自动补全这段时间 */
  interludeFill?: boolean
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
 * 「我看到了金刚狼」这类句式。
 * 名字既不是说话人也不是动作主体，只出现在正文里 —— 概要式输入几乎都是这个样子。
 */
const ENCOUNTER_RE =
  /(?:看到|看见|遇到|撞见|碰上|见到|发现|注意到|望向|盯着|走近)\s*(?:了|着)?\s*([\u4e00-\u9fa5A-Za-z·]{2,6})/g

/** 正则贪心会把「阿七站在后面」整个吃进来，这里把跟在名字后面的动词短语砍掉 */
const NAME_STOP_RE =
  /(站在|坐在|正站|正坐|已经|还是|就是|也在|走了|说话|开口|抬头|低头|看着|望着|似乎|好像|显然|一直|没有|不动|朝我|向我|正在).*$/

function cleanNameCandidate(input: unknown): string {
  const text = asText(input)
  if (!text) return ''
  return text.replace(NAME_STOP_RE, '').trim()
}

/**
 * 从拆解结果里用规则抓人名，作为「绝不允许漏掉在场者」的保险。
 *
 * 四个来源都要看：
 * - 说话人
 * - 动作主体
 * - 拆解阶段标出来的实体表
 * - **正文里的「看到 / 遇到 XX」** —— 只说「我看到了谁」时，前三个来源可能全是空的
 */
export function extractNamesFromSegments(
  segments: Segment[],
  pcName: string,
  entities: EntityMention[] = [],
  options: { includeMentioned?: boolean } = {},
): string[] {
  const names = new Set<string>()

  for (const segment of segments) {
    if (segment.speaker && segment.speaker !== pcName) names.add(segment.speaker.trim())
    for (const subject of segment.subject ?? []) {
      if (subject && subject !== pcName) names.add(subject.trim())
    }
    for (const match of segment.text.matchAll(ENCOUNTER_RE)) {
      const candidate = cleanNameCandidate(match[1])
      if (candidate && candidate !== pcName) names.add(candidate)
    }
  }

  for (const entity of entities) {
    if (entity.kind !== 'person') continue
    if (entity.mention === pcName) continue
    // 「只是被提到」的人默认不进在场名单，否则会把不在场的人硬拉进来；
    // 但一个都抓不到时会退让（见 ensurePresentHasActors）
    if (entity.role === 'mentioned' && !options.includeMentioned) continue
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

  // 先按严格标准抓人；一个都抓不到时，把「只是被提到」的也拉进来当最后兜底 ——
  // 宁可多给一个反应机会，也好过整轮被判成「场上没人」
  let names = extractNamesFromSegments(segments, pcName, entities)
  if (!names.length) {
    names = extractNamesFromSegments(segments, pcName, entities, { includeMentioned: true })
  }

  for (const name of names) {
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
    interlude: parseInterlude(raw.interlude),
    unchanged:
      raw.unchanged === true ||
      String(raw.unchanged ?? '').trim().toLowerCase() === 'true',
  }
}

/** 时间跳跃期间的补全：共享的一段 + 每个人各自的一条 */
function parseInterlude(raw: unknown): SceneInterlude | undefined {
  const record = asRecord(raw)
  if (!record) return undefined

  const summary = asText(record.summary).trim()
  const each: { who: string; what: string }[] = []
  for (const item of asArray(record.each)) {
    const entry = asRecord(item)
    const who = asText(entry?.who).trim()
    const what = asText(entry?.what).trim()
    if (!who || !what) continue
    each.push({ who, what })
  }

  if (!summary && !each.length) return undefined
  return { summary, each }
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
    // 没跑成模型时不能声称"没变" —— 我们没有依据
    unchanged: false,
    present,
    establishedBeats,
    usedModel: false,
    fallbackReason,
  }
}

/** 「前面的人」「那家伙」这类指代，不该变成一个新角色 */
const PRONOUN_RE = /(那个人|这个人|那人|这人|对方|前面的人|后面的人|身旁的人|身边的人|那个男人|那个女人|他|她)/

function looksLikePronoun(name: string): boolean {
  return name.length <= 6 && PRONOUN_RE.test(name)
}

/**
 * 把「前面的人」这类称呼归并回已知角色。
 *
 * 主要靠提示词让模型自己解析；这里是代码侧的兜底：
 * 1. 名字正好命中已知角色的名字或别名 → 归并
 * 2. 明确是个指代，且这个故事里**只有一个**已知角色 → 那就多半是他
 */
export function mergeIntoKnownCast(present: ScenePresent[], knownCast: KnownCastEntry[]): ScenePresent[] {
  if (!knownCast.length) return present

  const out: ScenePresent[] = []
  const taken = new Set<string>()

  for (const item of present) {
    const known = resolveKnownName(item.name, knownCast)
    const fallback =
      !known && looksLikePronoun(item.name) && knownCast.length === 1 ? knownCast[0] : null
    const target = known ?? fallback

    if (!target) {
      out.push(item)
      continue
    }
    if (taken.has(target.name) || out.some((existing) => existing.name === target.name)) continue
    taken.add(target.name)
    out.push({ ...item, name: target.name })
  }

  return out
}

export async function runSceneStage(
  client: LlmClient,
  input: SceneStageInput,
): Promise<{ output: SceneSetup; result: ChatResult | null }> {
  const {
    doc,
    segments,
    project,
    previousScene,
    rating = 'general',
    entities = [],
    knownCast,
    previousRecap,
    interludeFill = project.interludeFill,
  } = input

  const messages = buildSceneMessages({
    doc,
    segments,
    pcName: project.pcName,
    pcPersona: project.pcPersona,
    storyTitle: project.storyTitle,
    previousScene,
    rating,
    knownCast,
    previousRecap,
    interludeFill,
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
    const withActors = ensurePresentHasActors(normalized.present, segments, project.pcName, entities)
    const present = mergeIntoKnownCast(withActors, knownCast ?? [])

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
