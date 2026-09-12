import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import type {
  CharacterCard,
  PerceiveCandidateRecord,
  PerceiveChannel,
  PerceptionEntry,
  PerceptionOutcome,
} from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { SituationState } from '@/types/situation'
import { asArray, asRecord, asText } from '@/utils/record'
import { clamp } from '@/utils/time'
import { buildPerceiveMessages, type PerceiveActor } from '../prompts/perceive'
import { z } from 'zod'

const CHANNELS: PerceiveChannel[] = ['sight', 'hearing', 'smell', 'touch', 'intuition', 'mind']

const RawPerceiveSchema = z.object({
  entries: z.array(z.unknown()).optional(),
})

export interface PerceiveStageInput {
  cards: CharacterCard[]
  segments: Segment[]
  exposure?: PcExposure
  sceneSetup?: SceneSetup
  pcName: string
  /** 这一轮「世界」自己发生的事 —— 也要分发给每个角色，谁没看见就是没看见 */
  situation?: SituationState
  /** 每个角色此刻在哪、注意力放在哪（key = characterId） */
  positions?: Record<string, string>
}

/**
 * 组装候选池：这一轮「实际发生了什么」，逐条编号。
 *
 * 分发层用编号引用，所以台词原文不会被转述走样 —— 引擎按编号取原文。
 *
 * 「没说出口的」只有在**场上确实有人能读到念头**时才放进来；
 * 而且下面还会对没有该能力的角色强制标记为 missed（双保险）。
 */
export function buildPerceiveCandidates(input: PerceiveStageInput): PerceiveCandidateRecord[] {
  const { cards, segments, exposure, sceneSetup, pcName, situation } = input
  const out: PerceiveCandidateRecord[] = []
  let ref = 0

  const push = (item: Omit<PerceiveCandidateRecord, 'ref'>) => {
    ref += 1
    out.push({ ...item, ref })
  }

  // 开场画面与「此刻正在发生什么」也要分发 ——
  // 它们可能写着「你绕到他背后」这种某个人根本看不到的东西
  for (const line of sceneSetup?.opening ?? []) {
    const text = line.trim()
    if (text) push({ kind: 'scene', text })
  }
  if (sceneSetup?.situation?.trim()) {
    push({ kind: 'scene', text: sceneSetup.situation.trim() })
  }

  for (const segment of segments) {
    if (segment.kind === 'action') {
      const who = segment.subject?.[0] ?? ''
      push({
        kind: 'action',
        text: who === pcName ? `你：${segment.text}` : `${who || '有人'}：${segment.text}`,
        from: who || undefined,
      })
      continue
    }
    if (segment.kind === 'speech') {
      const who = segment.speaker ?? '有人'
      push({
        kind: 'speech',
        text: who === pcName ? `你：「${segment.text}」` : `${who}：「${segment.text}」`,
        from: segment.speaker ?? undefined,
      })
      continue
    }
    if (segment.kind === 'scene') {
      push({ kind: 'scene', text: segment.text })
      continue
    }
    if (segment.kind === 'ambient' || segment.kind === 'narration') {
      push({ kind: 'ambient', text: segment.text })
      continue
    }
    if (segment.kind === 'worldfact' || segment.kind === 'offscreen') {
      push({ kind: 'scene', text: segment.text })
    }
  }

  const anyoneCanReadMind = cards.some((card) => card.mindReading.trim())
  if (anyoneCanReadMind) {
    for (const segment of segments) {
      if (segment.kind !== 'inner') continue
      const owner = segment.subject?.[0]
      if (owner && owner !== pcName) continue
      push({ kind: 'inner', text: segment.text, from: pcName })
    }
  }

  for (const cue of exposure?.cues ?? []) {
    push({ kind: 'cue', text: cue.visible, from: pcName })
  }

  // 世界自己发生的事排在最后 —— 它是这一轮的推进，不是谁的言行。
  // 但它一样要经过分发：背对着的人就是没看见。
  for (const event of situation?.events ?? []) {
    const text = event.text.trim()
    if (!text) continue
    // 标成 event 而不是 scene/ambient：它是**这一轮正在发生的事**，
    // 要和 pc 的言行并列在同一条时间线上，而不是被塞进「眼前的环境」当背景。
    push({ kind: 'event', text })
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

function normalizeRefList(raw: unknown, validRefs: Set<number>): number[] {
  const out: number[] = []
  for (const entry of asArray(raw)) {
    const ref = Number(entry)
    if (!Number.isFinite(ref) || !validRefs.has(ref)) continue
    out.push(Math.floor(ref))
  }
  return out
}

function normalizeMissed(raw: unknown, validRefs: Set<number>): PerceptionEntry['missed'] {
  const out: PerceptionEntry['missed'] = []
  for (const entry of asArray(raw)) {
    const item = asRecord(entry)
    if (!item) continue
    const ref = Number(item.ref)
    if (!Number.isFinite(ref) || !validRefs.has(ref)) continue
    out.push({ ref: Math.floor(ref), why: asText(item.why) || '（未说明理由）' })
  }
  return out
}

function normalizeDistorted(raw: unknown, validRefs: Set<number>): PerceptionEntry['distorted'] {
  const out: PerceptionEntry['distorted'] = []
  for (const entry of asArray(raw)) {
    const item = asRecord(entry)
    if (!item) continue
    const ref = Number(item.ref)
    if (!Number.isFinite(ref) || !validRefs.has(ref)) continue
    const as = asText(item.as)
    if (!as) continue
    out.push({ ref: Math.floor(ref), as })
  }
  return out
}

function normalizeExtras(raw: unknown, allowMind: boolean): PerceptionEntry['extras'] {
  const out: PerceptionEntry['extras'] = []
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

function emptyEntry(card: CharacterCard, note: string, forcedMissed: PerceptionEntry['missed'] = []): PerceptionEntry {
  return { characterId: card.id, name: card.name, missed: forcedMissed, distorted: [], extras: [], note }
}

/**
 * 信息分发。
 *
 * 一次调用，让每个角色各自接收到属于他的那一份 —— 包括**明面上的东西**，
 * 因为「算不算明面」本身就是一次需要结合位置与注意力的判断，不该由引擎代劳。
 *
 * 默认全收到、只报偏差，所以模型输出短，台词原文也不会被转述走样。
 */
export async function runPerceiveStage(
  client: LlmClient,
  input: PerceiveStageInput,
): Promise<{ output: PerceptionOutcome; result: ChatResult | null }> {
  const { cards, pcName } = input

  if (!cards.length) {
    return { output: { candidates: [], entries: [], usedModel: false }, result: null }
  }

  const candidates = buildPerceiveCandidates(input)
  const validRefs = new Set(candidates.map((item) => item.ref))
  const innerRefs = candidates.filter((item) => item.kind === 'inner').map((item) => item.ref)

  /** 没有读取能力的角色读不到念头 —— 引擎强制兜底，不依赖模型 */
  const forcedMissedFor = (card: CharacterCard): PerceptionEntry['missed'] =>
    card.mindReading.trim()
      ? []
      : innerRefs.map((ref) => ({ ref, why: '他没有读取别人内心的能力' }))

  if (!candidates.length) {
    return {
      output: {
        candidates,
        entries: cards.map((card) => emptyEntry(card, '这一轮没有值得分发的信息。', forcedMissedFor(card))),
        usedModel: false,
      },
      result: null,
    }
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
      const card = byName.get(asText(item.name))
      if (!card || seen.has(card.id)) continue
      seen.add(card.id)

      const allowMind = Boolean(card.mindReading.trim())
      // 强制兜底 + 模型自己报的，合并去重
      const forced = forcedMissedFor(card)
      const reported = normalizeMissed(item.missed, validRefs)
      const merged = new Map<number, { ref: number; why: string }>()
      for (const entry of [...forced, ...reported]) merged.set(entry.ref, entry)

      entries.push({
        characterId: card.id,
        name: card.name,
        missed: [...merged.values()],
        distorted: normalizeDistorted(item.distorted, validRefs).filter((entry) => !merged.has(entry.ref)),
        extras: normalizeExtras(item.extras, allowMind),
        note: asText(item.note),
      })
    }

    // 模型漏掉的人补上空条目 —— 名单里有几个就该有几个，一个不少
    for (const card of cards) {
      if (seen.has(card.id)) continue
      entries.push(emptyEntry(card, '（分发时漏掉了这个人，按全部收到处理）', forcedMissedFor(card)))
    }

    void normalizeRefList
    return { output: { candidates, entries, usedModel: true }, result }
  } catch (error) {
    // 分发失败时按「全都收到了」处理 —— 宁可多给信息，也不要凭空扣掉
    return {
      output: {
        candidates,
        entries: cards.map((card) => emptyEntry(card, '（信息分发失败，按全部收到处理）', forcedMissedFor(card))),
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
