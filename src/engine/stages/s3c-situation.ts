import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type { CharacterCard } from '@/types/character'
import type { SituationEvent, SituationDirection, SituationPace, SituationState } from '@/types/situation'
import { RawSituationSchema } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { ContentRating } from '@/types/step'
import type { NormalizedDoc } from './s0-normalize'
import { asArray, asRecord, asText } from '@/utils/record'
import { buildSituationMessages, type SituationDrive } from '../prompts/situation'

export interface SituationStageInput {
  doc: NormalizedDoc
  segments: Segment[]
  sceneSetup: SceneSetup
  cards: CharacterCard[]
  pcName: string
  storyTitle: string
  /** 这一轮用户主动交棒了（什么都没做） */
  idle?: boolean
  /** 这一轮的分级 —— 导演要按它决定场面往哪推 */
  rating?: ContentRating
  /** 「快速进入」 */
  direct?: boolean
  previousRecap?: string
  previous?: { pressure: string; escalation: string; pace?: SituationPace } | null
}

const MAX_EVENTS = 3
const MAX_DIRECTIONS = 3

const PACES: SituationPace[] = ['build', 'escalate', 'climax', 'settle']

function normalizePace(raw: unknown): SituationPace {
  const value = asText(raw).trim().toLowerCase() as SituationPace
  return PACES.includes(value) ? value : 'build'
}

/** 出场顺序：只保留在场的名字，顺序照给 */
function normalizeOrder(raw: unknown, cards: CharacterCard[]): string[] {
  const known = new Map<string, string>()
  for (const card of cards) {
    known.set(card.name, card.name)
    for (const alias of card.aliases ?? []) known.set(alias, card.name)
  }

  const out: string[] = []
  for (const item of asArray(raw)) {
    const name = asText(item).trim()
    const resolved = known.get(name)
    if (!resolved || out.includes(resolved)) continue
    out.push(resolved)
  }
  return out
}

function normalizeDirections(raw: unknown, cards: CharacterCard[], pcName: string): SituationDirection[] {
  const byName = new Map<string, string>()
  for (const card of cards) {
    if (card.name === pcName) continue
    byName.set(card.name, card.name)
    for (const alias of card.aliases ?? []) byName.set(alias, card.name)
  }

  const out: SituationDirection[] = []
  for (const item of asArray(raw)) {
    const record = asRecord(item)
    const who = byName.get(asText(record?.who).trim())
    if (!who || out.some((entry) => entry.who === who)) continue
    const push = asText(record?.push).trim()
    const act = asText(record?.act).trim()
    const noInteract =
      record?.noInteract === true || asText(record?.noInteract).toLowerCase() === 'true'
    // push 和 act 至少要有一样 —— 只有名字的任务是空任务
    if (!push && !act && !noInteract) continue
    out.push({ who, push, act: act || undefined, noInteract: noInteract || undefined })
    // 导演每一轮都可以派人，最多三个：不要把人全点一遍
    if (out.length >= MAX_DIRECTIONS) break
  }
  return out
}

function normalizeEvents(raw: unknown, pcName: string): SituationEvent[] {
  const out: SituationEvent[] = []
  for (const item of asArray(raw)) {
    const record = asRecord(item)
    const text = asText(record?.text).trim()
    if (!text) continue
    const kind = asText(record?.kind).toLowerCase() === 'scene' ? 'scene' : 'ambient'
    // 落在用户身上的事件只认用户自己 —— 替角色做决定不是导演的活，角色有自己的反应通道
    out.push({ kind, text })
    if (out.length >= MAX_EVENTS) break
  }
  return out
}

function drivesOf(cards: CharacterCard[]): SituationDrive[] {
  return cards.map((card) => ({
    name: card.name,
    drive: card.persona.drive ?? '',
    brief: [card.state.location, card.state.mood].filter(Boolean).join('，'),
  }))
}

/**
 * S3c：局面推进。
 *
 * 每轮一次调用（不是每个角色一次），让「世界」自己往前走一步。
 * 它的产物会进时间线、进信息分发，所以角色看得见、也必须回应 ——
 * 这就是「离了用户剧情也能继续走」的那台发动机。
 *
 * 调用失败不阻断整轮：压力沿用上一轮，这一轮不产出新事件。
 */
export async function runSituationStage(
  client: LlmClient,
  input: SituationStageInput,
): Promise<{ output: SituationState; result: ChatResult | null }> {
  const { doc, segments, sceneSetup, cards, pcName, storyTitle, idle, rating, direct, previousRecap, previous } =
    input

  const messages = buildSituationMessages({
    storyTitle,
    pcName,
    idle,
    rating,
    direct,
    doc,
    segments,
    sceneSetup,
    previousRecap,
    previous,
    drives: drivesOf(cards),
  })

  try {
    const { data, result } = await client.chatJson<unknown>(messages, {
      temperature: client.settings.temperatureCreative,
      json: true,
      label: 'situation',
      parse: (raw) => RawSituationSchema.parse(raw),
    })

    const parsed = data as {
      pace?: unknown
      pressure?: unknown
      escalation?: unknown
      events?: unknown
      order?: unknown
      directions?: unknown
      note?: unknown
    }
    return {
      output: {
        pace: normalizePace(parsed.pace),
        pressure: asText(parsed.pressure).trim() || previous?.pressure || '',
        escalation: asText(parsed.escalation).trim(),
        events: normalizeEvents(parsed.events, pcName),
        order: normalizeOrder(parsed.order, cards),
        directions: normalizeDirections(parsed.directions, cards, pcName),
        note: asText(parsed.note) || undefined,
        usedModel: true,
      },
      result,
    }
  } catch (error) {
    return {
      output: {
        pace: previous?.pace ?? 'build',
        pressure: previous?.pressure ?? '',
        escalation: previous?.escalation ?? '',
        events: [],
        order: [],
        directions: [],
        note: '（局面推进失败，这一轮世界原地不动）',
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
