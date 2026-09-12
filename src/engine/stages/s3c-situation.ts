import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type { CharacterCard } from '@/types/character'
import type { SituationEvent, SituationState } from '@/types/situation'
import { RawSituationSchema } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
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
  previousRecap?: string
  previous?: { pressure: string; escalation: string } | null
}

const MAX_EVENTS = 3

function normalizeEvents(raw: unknown): SituationEvent[] {
  const out: SituationEvent[] = []
  for (const item of asArray(raw)) {
    const record = asRecord(item)
    const text = asText(record?.text).trim()
    if (!text) continue
    const kind = asText(record?.kind).toLowerCase() === 'scene' ? 'scene' : 'ambient'
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
  const { doc, segments, sceneSetup, cards, pcName, storyTitle, previousRecap, previous } = input

  const messages = buildSituationMessages({
    storyTitle,
    pcName,
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

    const parsed = data as { pressure?: unknown; escalation?: unknown; events?: unknown; note?: unknown }
    return {
      output: {
        pressure: asText(parsed.pressure).trim() || previous?.pressure || '',
        escalation: asText(parsed.escalation).trim(),
        events: normalizeEvents(parsed.events),
        note: asText(parsed.note) || undefined,
        usedModel: true,
      },
      result,
    }
  } catch (error) {
    return {
      output: {
        pressure: previous?.pressure ?? '',
        escalation: previous?.escalation ?? '',
        events: [],
        note: '（局面推进失败，这一轮世界原地不动）',
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
