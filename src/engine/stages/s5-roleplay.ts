import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import {
  RawRoleplaySchema,
  type Beat,
  type ContextBundle,
  type RawRoleplay,
  type RoleplayOutput,
} from '@/types/character'
import type { ContentRating } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'
import { asArray, asRecord, asText, asTextArray } from '@/utils/record'
import { buildRoleplayMessages } from '../prompts/roleplay'

const BEAT_KINDS: Beat['kind'][] = ['speech', 'action', 'cue']

function normalizeBeatKind(input: unknown): Beat['kind'] {
  const text = String(input ?? '').trim().toLowerCase()
  if (['speech', '台词', '对话', '说', 'say', 'line'].includes(text)) return 'speech'
  if (['action', '动作', '行为', 'do', 'act'].includes(text)) return 'action'
  if (BEAT_KINDS.includes(text as Beat['kind'])) return text as Beat['kind']
  return 'cue'
}

function normalizeStringArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof input === 'string' && input.trim()) {
    return input
      .split(/[、,，/;；\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

/** 把模型输出归一化，并守住「别人读不到你的内心」这条线：inner 单独存放 */
export function normalizeRoleplayOutput(raw: RawRoleplay, bundle: ContextBundle): RoleplayOutput {
  const beats: Beat[] = []

  for (const entry of asArray(raw.beats)) {
    const item = asRecord(entry)
    if (!item) continue
    const text = asText(item.text)
    if (!text) continue
    beats.push({
      kind: normalizeBeatKind(item.kind),
      text,
      addressee: asTextArray(item.addressee),
    })
  }

  const hasSpeech = beats.some((beat) => beat.kind === 'speech')
  const silentReason = asText(raw.silentReason) || undefined

  return {
    characterId: bundle.characterId,
    name: bundle.name,
    beats,
    inner: asText(raw.inner) || undefined,
    mood: asText(raw.mood) || undefined,
    silentReason: hasSpeech ? silentReason : (silentReason ?? '（这一轮没有说话）'),
  }
}

export interface RoleplayStageInput {
  bundle: ContextBundle
  project: ProjectSettings
  /** 这一轮的分级 */
  rating?: ContentRating
}

export async function runRoleplayStage(
  client: LlmClient,
  input: RoleplayStageInput,
): Promise<{ output: RoleplayOutput; result: ChatResult | null }> {
  const messages = buildRoleplayMessages(input)

  const { data, result } = await client.chatJson<RawRoleplay>(messages, {
    temperature: client.settings.temperatureCreative,
    json: true,
    label: `roleplay:${input.bundle.name}`,
    parse: (raw) => RawRoleplaySchema.parse(raw),
  })

  return { output: normalizeRoleplayOutput(data, input.bundle), result }
}
