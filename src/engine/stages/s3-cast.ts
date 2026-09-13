import type { LlmClient } from '@/engine/llm/client'
import { findInLibrary } from '@/engine/memory/library'
import { lookupMany, type WikiLookup } from '@/engine/research/wiki'
import type { ChatResult } from '@/types/llm'
import {
  RawCastResultSchema,
  type CardSource,
  type CastTier,
  type CharacterCard,
  type KnownCastEntry,
  type RawCastResult,
} from '@/types/character'
import type { ScenePresent } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { ProjectSettings } from '@/types/settings'
import { asArray, asRecord, asText, asTextArray } from '@/utils/record'
import { buildCastMessages } from '../prompts/cast'
import type { NormalizedDoc } from './s0-normalize'

export interface CastStageInput {
  doc: NormalizedDoc
  segments: Segment[]
  project: ProjectSettings
  /** 由 S2 场景构建确定的在场名单 */
  present: ScenePresent[]
  /** 跨轮角色库：以前出场过的角色直接复用，不再重新生成 */
  library?: Record<string, CharacterCard>
  /** 是否联网给新角色查资料（维基百科，免 key） */
  enableResearch?: boolean
  /** 这个故事里已经出场过的人，用来把「前面的人」这类称呼归并回去 */
  knownCast?: KnownCastEntry[]
  /** 前面已经演过的剧情 */
  previousRecap?: string
}

export interface CastStageOutput {
  characters: CharacterCard[]
  usedModel: boolean
  /** 其中有多少张卡是从角色库里直接复用的 */
  reusedCount: number
  /** 查到了多少份外部资料 */
  researchedCount: number
  fallbackReason?: string
}

/** 用名字派生稳定 id：同一个角色跨轮次都是同一个 id */
export function stableCharacterId(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return `char_${Math.abs(hash).toString(36)}`
}

function normalizeBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input
  if (typeof input === 'number') return input !== 0
  const text = String(input ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1', '是', '出场', '在场'].includes(text)) return true
  if (['false', 'no', 'n', '0', '否', '没出场', '不在场', '仅提及'].includes(text)) return false
  return fallback
}

function normalizeTier(input: unknown, fallback: CastTier): CastTier {
  const text = String(input ?? '').trim().toLowerCase()
  if (['major', '主要', '主角', '重要'].includes(text)) return 'major'
  if (['minor', '次要', '配角'].includes(text)) return 'minor'
  if (['extra', '路人', '次抛', '龙套', '背景'].includes(text)) return 'extra'
  return fallback
}

function normalizeStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item ?? '').trim()).filter(Boolean)
  }
  if (typeof input === 'string' && input.trim()) {
    return input
      .split(/[、,，/;；\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function isLikelyName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 8) return false
  if (/[，。！？、；：「」“”（）()]/.test(trimmed)) return false
  return /^[\u4e00-\u9fa5A-Za-z·\s]+$/.test(trimmed)
}

function pickSource(found: WikiLookup | undefined, canonical: boolean): CardSource {
  if (found) return 'wiki'
  return canonical ? 'model' : 'material'
}

export function normalizeCastResult(
  raw: RawCastResult,
  pcName: string,
  research: Record<string, WikiLookup> = {},
): CharacterCard[] {
  const seen = new Set<string>()
  const cards: CharacterCard[] = []

  for (const entry of asArray(raw.characters)) {
    const item = asRecord(entry)
    if (!item) continue

    const name = asText(item.name)
    if (!name || !isLikelyName(name)) continue
    if (name === pcName) continue
    if (seen.has(name)) continue
    seen.add(name)

    const found = research[name]
    const canonical = normalizeBool(item.canonical, Boolean(found))
    const appears = normalizeBool(item.appearsInInput, true)

    cards.push({
      id: stableCharacterId(name),
      name,
      aliases: asTextArray(item.aliases),
      tier: normalizeTier(item.tier, appears ? 'major' : 'minor'),
      origin: 'generated',
      canonical,
      franchise: asText(item.franchise),
      source: pickSource(found, canonical),
      researchNote: found
        ? `【${found.lang === 'zh' ? '中文' : '英文'}维基 · ${found.title}】${found.extract}`
        : undefined,
      persona: {
        summary: asText(item.summary) || '（素材里没有更多说明）',
        drive: asText(item.drive),
        speechStyle: asText(item.speechStyle) || '（按性格自然发挥）',
        temperament: asTextArray(item.temperament),
        habits: asTextArray(item.habits),
        background: asText(item.background) || '（素材里没有更多说明）',
        signature: asTextArray(item.signature),
        voiceSamples: asTextArray(item.voiceSamples),
        canonAnchors: asTextArray(item.canonAnchors),
        boundaries: asTextArray(item.boundaries),
        abilities: asTextArray(item.abilities),
        perception: asTextArray(item.perception),
        hooks: asTextArray(item.hooks),
      },
      // 读心是一段谱系而不是开关，所以这里存的是描述文本，空字符串表示没有这种能力
      mindReading: asText(item.mindReading),
      state: {
        mood: asText(item.mood) || '（未说明）',
        location: asText(item.location) || '（未说明）',
      },
      appearsInInput: appears,
      evidence: asText(item.evidence),
    })
  }

  return cards
}

function thinCard(item: ScenePresent): CharacterCard {
  return {
    id: stableCharacterId(item.name),
    name: item.name,
    aliases: [],
    tier: item.kind === 'extra' ? 'extra' : 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: item.role || '（场景里出现的人）',
      drive: '',
      speechStyle: '（按性格自然发挥）',
      temperament: [],
      habits: [],
      background: item.brief || '（素材里没有更多说明）',
      signature: [],
      voiceSamples: [],
      canonAnchors: [],
      boundaries: [],
      abilities: [],
      perception: [],
      hooks: [],
    },
    state: { mood: '（未说明）', location: '' },
    appearsInInput: true,
    evidence: '场景构建判定为在场',
  }
}

/**
 * 以场景构建给出的在场名单为准：
 * 名单里的人必须有卡（模型没给就补一张薄卡），名单外的人一律不要。
 */
export function mergeWithPresent(cards: CharacterCard[], present: ScenePresent[]): CharacterCard[] {
  const byName = new Map(cards.map((card) => [card.name, card]))
  const out: CharacterCard[] = []

  for (const item of present) {
    const existing = byName.get(item.name)
    if (!existing) {
      out.push(thinCard(item))
      continue
    }
    const tier: CastTier = existing.tier === 'major' && item.kind === 'extra' ? 'minor' : existing.tier
    out.push({ ...existing, tier, appearsInInput: true })
  }

  return out
}

/** 模型不可用时的降级：直接用名单建薄卡 */
export function buildCastFromPresent(present: ScenePresent[]): CharacterCard[] {
  return present.map(thinCard)
}

export async function runCastStage(
  client: LlmClient,
  input: CastStageInput,
): Promise<{ output: CastStageOutput; result: ChatResult | null }> {
  const { doc, segments, project, present, library = {}, enableResearch = true, knownCast, previousRecap } = input
  const activePresent = present.filter((item) => item.name !== project.pcName)

  if (!activePresent.length) {
    return {
      output: {
        characters: [],
        usedModel: false,
        reusedCount: 0,
        researchedCount: 0,
        fallbackReason: '这一轮没有其他人在场',
      },
      result: null,
    }
  }

  // 以前出场过的角色：直接复用他的卡，保持人设一致，也省掉一次调用
  const known: CharacterCard[] = []
  const fresh: ScenePresent[] = []
  for (const item of activePresent) {
    const existing = findInLibrary(library, item.name)
    if (existing) {
      known.push({ ...existing, appearsInInput: true })
    } else {
      fresh.push(item)
    }
  }

  if (!fresh.length) {
    return {
      output: { characters: known, usedModel: false, reusedCount: known.length, researchedCount: 0 },
      result: null,
    }
  }

  // 给新角色查资料。查不到（网络不通、没有条目）就静默跳过，让模型用自己的知识。
  let research: Record<string, WikiLookup> = {}
  if (enableResearch) {
    try {
      research = await lookupMany(fresh.map((item) => item.name))
    } catch {
      research = {}
    }
  }

  const messages = buildCastMessages({
    doc,
    segments,
    pcName: project.pcName,
    storyTitle: project.storyTitle,
    present: fresh,
    research,
    knownCast,
    previousRecap,
  })

  try {
    const { data, result } = await client.chatJson<RawCastResult>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: 'cast',
      parse: (raw) => RawCastResultSchema.parse(raw),
    })

    const created = mergeWithPresent(normalizeCastResult(data, project.pcName, research), fresh)

    // 模型有时候会把 characters 交成空数组 —— 而场景那边明明给了在场名单。
    // 这时候不能就当真没人：**按名单兜底建卡**，否则这一轮会连一个角色反应都没有，
    // 界面上看起来就是"剧情断在局面那里"。
    const fallback = created.length ? created : buildCastFromPresent(fresh)

    // 兜底也救不回来时，把**是哪一种空**写清楚 —— 这两种情况在界面上长得一样，
    // 但一个说明"这一轮真的没别人"，另一个说明"阵容解析空转了"，得能分辨。
    const fallbackReason = created.length
      ? undefined
      : fresh.length
        ? `模型没有给出角色，已按在场名单（${fresh.length} 人）兜底`
        : '模型没有给出角色，场景的在场名单也是空的'

    return {
      output: {
        characters: [...known, ...fallback],
        usedModel: true,
        reusedCount: known.length,
        researchedCount: fallback.filter((card) => card.source === 'wiki').length,
        ...(fallbackReason ? { fallbackReason } : {}),
      },
      result,
    }
  } catch (error) {
    return {
      output: {
        characters: [...known, ...buildCastFromPresent(fresh)],
        usedModel: false,
        reusedCount: known.length,
        researchedCount: 0,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
