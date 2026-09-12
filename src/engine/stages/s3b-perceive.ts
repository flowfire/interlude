import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type { CharacterCard, PerceiveChannel, PerceptionOutcome } from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { Segment } from '@/types/segment'
import { asArray, asRecord, asText } from '@/utils/record'
import { clamp } from '@/utils/time'
import { buildPerceiveMessages, type PerceiveCandidate } from '../prompts/perceive'
import { z } from 'zod'

const CHANNELS: PerceiveChannel[] = ['sight', 'hearing', 'smell', 'touch', 'intuition', 'mind']

const RawPerceiveSchema = z.object({
  perceived: z.array(z.unknown()).optional(),
  note: z.union([z.string(), z.number(), z.null()]).optional(),
})

export interface PerceiveStageInput {
  card: CharacterCard
  name: string
  segments: Segment[]
  exposure?: PcExposure
  pcName: string
  /** 他此刻的位置与注意力 */
  position: string
}

/**
 * 组装候选池。
 *
 * 注意「没说出口的」只对有读取能力的角色开放 ——
 * 不能因为有这一层判定，就把内心原文发给所有角色的提示词。
 */
export function buildPerceiveCandidates(input: PerceiveStageInput): PerceiveCandidate[] {
  const { card, segments, exposure, pcName } = input
  const out: PerceiveCandidate[] = []

  for (const segment of segments) {
    if (segment.kind === 'action') {
      const who = segment.subject?.[0] ?? ''
      out.push({ kind: '动作', text: who === pcName ? `你：${segment.text}` : `${who || '有人'}：${segment.text}` })
      continue
    }
    if (segment.kind === 'scene' || segment.kind === 'ambient') {
      out.push({ kind: '环境', text: segment.text })
    }
  }

  if (card.mindReading.trim()) {
    for (const segment of segments) {
      if (segment.kind !== 'inner') continue
      const owner = segment.subject?.[0]
      if (owner && owner !== pcName) continue
      out.push({ kind: '没说出口的', text: segment.text })
    }
  }

  for (const cue of exposure?.cues ?? []) {
    out.push({ kind: '细微表现', text: cue.visible })
  }

  return out
}

function normalizePerceived(raw: unknown): PerceptionOutcome['perceived'] {
  const out: PerceptionOutcome['perceived'] = []
  for (const entry of asArray(raw)) {
    const item = asRecord(entry)
    if (!item) continue
    const text = asText(item.text)
    if (!text) continue
    const channelRaw = asText(item.channel).toLowerCase()
    const channel = (CHANNELS.includes(channelRaw as PerceiveChannel) ? channelRaw : 'intuition') as PerceiveChannel
    out.push({ text, channel, certainty: clamp(Number(item.certainty ?? 0.5), 0, 1) })
    if (out.length >= 5) break
  }
  return out
}

/**
 * 感知判定。
 *
 * 独立于扮演阶段：先判「他察觉到了什么」，扮演环节只拿到这份结果。
 * 明面上的东西走的是直接通道，这里只处理「不一定谁都能察觉到」的部分 ——
 * 超常感官和读取内心是同一个逻辑层的两种通道。
 */
export async function runPerceiveStage(
  client: LlmClient,
  input: PerceiveStageInput,
): Promise<{ output: PerceptionOutcome; result: ChatResult | null }> {
  const { card, name, segments, exposure, pcName, position } = input
  const base = { characterId: card.id, name }

  const hasExtraSense = Boolean(card.persona.perception?.length || card.mindReading.trim())
  if (!hasExtraSense) {
    return {
      output: {
        ...base,
        perceived: [],
        note: '他的感官与常人无异 —— 明面上的东西已经直接给他了。',
        usedModel: false,
      },
      result: null,
    }
  }

  const candidates = buildPerceiveCandidates(input)
  if (!candidates.length) {
    return { output: { ...base, perceived: [], note: '这一轮没有值得他额外察觉的东西。', usedModel: false }, result: null }
  }

  const messages = buildPerceiveMessages({
    readerName: name,
    senses: card.persona.perception ?? [],
    mindReading: card.mindReading,
    position,
    candidates,
  })

  try {
    const { data, result } = await client.chatJson<unknown>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: `perceive:${name}`,
      parse: (raw) => RawPerceiveSchema.parse(raw),
    })

    const parsed = data as { perceived?: unknown; note?: unknown }
    const perceived = normalizePerceived(parsed.perceived)
    const note = asText(parsed.note) || (perceived.length ? '' : '什么都没多察觉到。')

    return { output: { ...base, perceived, note, usedModel: true }, result }
  } catch (error) {
    // 判定失败时按「什么都没多察觉到」处理 —— 这是最安全的一侧
    return {
      output: {
        ...base,
        perceived: [],
        note: '（感知判定失败，按什么都没多察觉到处理）',
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
