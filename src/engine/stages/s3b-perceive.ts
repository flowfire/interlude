import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type {
  CharacterCard,
  PerceiveChannel,
  PerceptionEntry,
  PerceptionOutcome,
} from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { Segment } from '@/types/segment'
import { asArray, asRecord, asText } from '@/utils/record'
import { clamp } from '@/utils/time'
import { buildPerceiveMessages, type PerceiveActor, type PerceiveCandidate } from '../prompts/perceive'
import { z } from 'zod'

const CHANNELS: PerceiveChannel[] = ['sight', 'hearing', 'smell', 'touch', 'intuition', 'mind']

const RawPerceiveSchema = z.object({
  entries: z.array(z.unknown()).optional(),
})

export interface PerceiveStageInput {
  cards: CharacterCard[]
  segments: Segment[]
  exposure?: PcExposure
  pcName: string
  /** 每个角色此刻在哪、注意力放在哪（key = characterId） */
  positions?: Record<string, string>
}

/**
 * 组装候选池：这一轮「实际发生了什么」。
 *
 * 注意「没说出口的」只有在**场上确实有人能读到念头**时才放进来 ——
 * 不能因为多了一层分发，就把内心原文发进一个没人能读心的提示词里。
 */
export function buildPerceiveCandidates(input: PerceiveStageInput): PerceiveCandidate[] {
  const { cards, segments, exposure, pcName } = input
  const out: PerceiveCandidate[] = []

  for (const segment of segments) {
    if (segment.kind === 'action') {
      const who = segment.subject?.[0] ?? ''
      out.push({ kind: '动作', text: who === pcName ? `你：${segment.text}` : `${who || '有人'}：${segment.text}` })
      continue
    }
    if (segment.kind === 'speech') {
      const who = segment.speaker ?? '有人'
      out.push({ kind: '说出口的', text: who === pcName ? `你：「${segment.text}」` : `${who}：「${segment.text}」` })
      continue
    }
    if (segment.kind === 'scene' || segment.kind === 'ambient') {
      out.push({ kind: '环境', text: segment.text })
    }
  }

  const anyoneCanReadMind = cards.some((card) => card.mindReading.trim())
  if (anyoneCanReadMind) {
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

function buildActors(input: PerceiveStageInput): PerceiveActor[] {
  return input.cards.map((card) => ({
    name: card.name,
    position:
      input.positions?.[card.id] ??
      ([card.state.location, card.state.mood].filter(Boolean).join('，') || '（未说明）'),
    senses: card.persona.perception ?? [],
    mindReading: card.mindReading,
  }))
}

function normalizePerceived(raw: unknown, allowMind: boolean): PerceptionEntry['perceived'] {
  const out: PerceptionEntry['perceived'] = []
  for (const entry of asArray(raw)) {
    const item = asRecord(entry)
    if (!item) continue
    const text = asText(item.text)
    if (!text) continue

    const channelRaw = asText(item.channel).toLowerCase()
    const channel = (CHANNELS.includes(channelRaw as PerceiveChannel) ? channelRaw : 'intuition') as PerceiveChannel
    // 兜底：没有读取能力的角色，不允许出现 mind 通道
    if (channel === 'mind' && !allowMind) continue

    out.push({ text, channel, certainty: clamp(Number(item.certainty ?? 0.5), 0, 1) })
    if (out.length >= 5) break
  }
  return out
}

/**
 * 信息分发。
 *
 * 一次调用，把这一轮实际发生的事转化成**每个角色各自接收到的版本**。
 *
 * 为什么合成一次而不是每人一次：
 * - 判断「谁背对着谁」这类空间关系需要全局视角，单个角色的调用看不见别人在哪
 * - 省掉 N-1 次调用
 *
 * 为什么必须有这一层：
 * 判断「他能察觉到什么」和「扮演角色」不能是同一个调用 ——
 * 否则后者手里握着原文，说什么都约束不住。原文留在这一层，不外流。
 */
export async function runPerceiveStage(
  client: LlmClient,
  input: PerceiveStageInput,
): Promise<{ output: PerceptionOutcome; result: ChatResult | null }> {
  const { cards, pcName } = input

  if (!cards.length) {
    return { output: { entries: [], usedModel: false }, result: null }
  }

  const emptyEntries = (note: string): PerceptionEntry[] =>
    cards.map((card) => ({ characterId: card.id, name: card.name, perceived: [], note }))

  const candidates = buildPerceiveCandidates(input)
  if (!candidates.length) {
    return { output: { entries: emptyEntries('这一轮没有值得分发的信息。'), usedModel: false }, result: null }
  }

  const messages = buildPerceiveMessages({
    pcName,
    actors: buildActors(input),
    candidates,
  })

  try {
    const { data, result } = await client.chatJson<unknown>(messages, {
      temperature: client.settings.temperaturePrecise,
      json: true,
      label: 'perceive',
      parse: (raw) => RawPerceiveSchema.parse(raw),
    })

    const parsed = data as { entries?: unknown }
    const byName = new Map(cards.map((card) => [card.name, card]))

    const entries: PerceptionEntry[] = []
    const seen = new Set<string>()

    for (const raw of asArray(parsed.entries)) {
      const item = asRecord(raw)
      if (!item) continue
      const name = asText(item.name)
      const card = byName.get(name)
      if (!card || seen.has(card.id)) continue
      seen.add(card.id)

      const allowMind = Boolean(card.mindReading.trim())
      entries.push({
        characterId: card.id,
        name: card.name,
        perceived: normalizePerceived(item.perceived, allowMind),
        note: asText(item.note),
      })
    }

    // 模型漏掉的人补上空条目 —— 名单里有几个就该有几个，一个不少
    for (const card of cards) {
      if (seen.has(card.id)) continue
      entries.push({
        characterId: card.id,
        name: card.name,
        perceived: [],
        note: '（分发时漏掉了这个人，按没额外察觉到处理）',
      })
    }

    return { output: { entries, usedModel: true }, result }
  } catch (error) {
    // 分发失败时按「谁都没多察觉到」处理 —— 这是最安全的一侧
    return {
      output: {
        entries: emptyEntries('（信息分发失败，按没额外察觉到处理）'),
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
