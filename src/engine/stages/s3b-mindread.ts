import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type { CharacterCard, MindReadOutcome } from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { Segment } from '@/types/segment'
import { asArray, asRecord, asText } from '@/utils/record'
import { clamp } from '@/utils/time'
import { buildMindReadMessages } from '../prompts/mindread'
import { findPcInnerLines } from './s2b-exposure'
import { z } from 'zod'

const RawMindReadSchema = z.object({
  readings: z.array(z.unknown()).optional(),
  note: z.union([z.string(), z.number(), z.null()]).optional(),
})

export interface MindReadStageInput {
  card: CharacterCard
  name: string
  segments: Segment[]
  exposure?: PcExposure
  pcName: string
}

function normalizeReadings(raw: unknown): { text: string; certainty: number }[] {
  const out: { text: string; certainty: number }[] = []
  for (const entry of asArray(raw)) {
    const item = asRecord(entry)
    if (!item) continue
    const text = asText(item.text)
    if (!text) continue
    out.push({ text, certainty: clamp(Number(item.certainty ?? 0.5), 0, 1) })
    if (out.length >= 4) break
  }
  return out
}

/**
 * 读取判定。
 *
 * 独立于扮演阶段：先判「他读到了什么」，扮演环节只拿到这份结果。
 * 这样原文根本不会出现在扮演的上下文里 —— 想全用也没得用。
 */
export async function runMindReadStage(
  client: LlmClient,
  input: MindReadStageInput,
): Promise<{ output: MindReadOutcome; result: ChatResult | null }> {
  const { card, name, segments, exposure, pcName } = input

  const base = { characterId: card.id, name }

  const innerLines = findPcInnerLines(segments, pcName)
  // 对方没写内心 → 没有可读的东西，不用调模型
  if (!innerLines.length || !card.mindReading.trim()) {
    return {
      output: {
        ...base,
        readings: [],
        note: card.mindReading.trim() ? '对方这一轮没有流露任何内心活动。' : '他没有读取别人内心的能力。',
        usedModel: false,
      },
      result: null,
    }
  }

  const leakage = exposure?.cues.length
    ? exposure.cues.reduce((sum, cue) => sum + cue.leakage, 0) / exposure.cues.length
    : 0.5

  const visibleCues = (exposure?.cues ?? []).map((cue) => cue.visible).filter(Boolean)

  const messages = buildMindReadMessages({
    readerName: name,
    ability: card.mindReading,
    targetName: pcName,
    innerLines,
    leakage,
    visibleCues,
  })

  try {
    const { data, result } = await client.chatJson<unknown>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: `mindread:${name}`,
      parse: (raw) => RawMindReadSchema.parse(raw),
    })

    const parsed = data as { readings?: unknown; note?: unknown }
    const readings = normalizeReadings(parsed.readings)
    const note = asText(parsed.note) || (readings.length ? '' : '什么都没读到。')

    return { output: { ...base, readings, note, usedModel: true }, result }
  } catch (error) {
    // 判定失败时按「读不到」处理 —— 这是最安全的一侧
    return {
      output: {
        ...base,
        readings: [],
        note: '（读取判定失败，按什么都没读到处理）',
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
