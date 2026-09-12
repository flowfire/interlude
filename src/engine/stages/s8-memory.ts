import type { ContextBundle, RoleplayOutput } from '@/types/character'
import type { MemoryEntry } from '@/types/memory'
import type { Round } from '@/types/step'
import { makeId } from '@/utils/id'
import { nowIso } from '@/utils/time'

export interface MemoryBuildInput {
  round: Round
  bundle: ContextBundle
  roleplay: RoleplayOutput
  /** 场面定位，例如「城南茶馆 · 傍晚」 */
  where: string
}

/**
 * S8：把这一轮的经过，翻译成**某个角色视角下的一段记忆**。
 *
 * 注意这里用的是「他拿到了什么 + 他说了什么做了什么」，
 * 而不是全知视角的剧本 —— 记忆必须是他自己经历的版本。
 */
export function buildMemoryEntry(input: MemoryBuildInput): MemoryEntry {
  const { round, bundle, roleplay, where } = input

  const heard = bundle.heard.map((item) => `${item.from}：「${item.text}」`)
  const said = roleplay.beats.filter((beat) => beat.kind === 'speech').map((beat) => beat.text)
  const did = roleplay.beats.filter((beat) => beat.kind !== 'speech').map((beat) => beat.text)
  const scene = bundle.sceneLines.slice(0, 4)
  const noticed = bundle.pcCues.map((cue) => cue.visible)

  const fragments: string[] = []
  for (const line of heard.slice(0, 3)) fragments.push(`听到 ${line}`)
  for (const line of said.slice(0, 2)) fragments.push(`你说了「${line}」`)
  if (!said.length && roleplay.silentReason) fragments.push(`你没有说话（${roleplay.silentReason}）`)
  for (const line of did.slice(0, 2)) fragments.push(`你${line}`)

  return {
    id: makeId('mem'),
    characterId: roleplay.characterId,
    roundId: round.id,
    roundIndex: round.index,
    at: nowIso(),
    where,
    summary: fragments.join('；') || '（这一轮没有发生对话）',
    details: { scene, heard, said, did, noticed },
    mood: roleplay.mood,
    inner: roleplay.inner,
  }
}

export function buildRoundMemories(inputs: MemoryBuildInput[]): MemoryEntry[] {
  return inputs.map(buildMemoryEntry)
}

/** 把场面设置压成一句定位，用于记忆的 where 字段 */
export function describeWhere(bundle: ContextBundle): string {
  const parts = [bundle.scene.place, bundle.scene.time].filter(Boolean)
  return parts.join(' · ') || '某处'
}
