import type { CharacterCard, ComposedScene, ReactionCard, RoleplayOutput, SceneBlock } from '@/types/character'
import type { PcCue, PcExposure } from '@/types/exposure'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { SituationState } from '@/types/situation'

export interface ComposeInput {
  sceneSetup: SceneSetup
  segments: Segment[]
  cards: CharacterCard[]
  roleplays: RoleplayOutput[]
  pcName: string
  /** 你这一轮内心外化的结果 —— 只有现象会进到舞台上 */
  exposure?: PcExposure
  /** 这一轮「世界」自己发生的事 */
  situation?: SituationState
}

/** 这些类型在舞台上表现为「环境」 */
const SCENE_KINDS = new Set(['scene', 'ambient', 'narration', 'worldfact', 'offscreen', 'unknown'])

/** 找出属于视角角色的内心片段，按原文顺序 */
export function pcInnerSegments(segments: Segment[], pcName: string): Segment[] {
  return segments
    .filter((segment) => segment.kind === 'inner')
    .filter((segment) => {
      const subject = segment.subject ?? []
      if (!subject.length) return true
      return subject.includes(pcName)
    })
    .sort((a, b) => a.sourceRange[0] - b.sourceRange[0])
}

function clampIndex(value: number, length: number): number {
  if (!length) return 0
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(Math.floor(value), length - 1)
}

/**
 * S7：编排。
 *
 * 最重要的一条：**用户是按时间顺序写的**。
 * 所以这里不再按类型分组重排，而是严格按原文顺序把这一轮重建出来 ——
 * 说一句、犹豫一下、再说一句、看他一眼……
 * 外化线索会被插回它对应的那句内心原本的位置。
 *
 * 这里刻意不调用模型：编排是确定性的，花钱让模型排序不划算，也容易改坏你的台词。
 */
export function composeScene(input: ComposeInput): ComposedScene {
  const { sceneSetup, segments, cards, roleplays, pcName, exposure, situation } = input
  const blocks: SceneBlock[] = []
  let order = 1

  const push = (block: Omit<SceneBlock, 'order'>) => {
    blocks.push({ ...block, order: order++ })
  }

  const cardByName = new Map(cards.map((card) => [card.name, card]))
  const seenScene = new Set<string>()

  // 1. 舞台布景：场景构建给出的开场画面
  for (const line of sceneSetup.opening) {
    const text = line.trim()
    if (!text || seenScene.has(text)) continue
    seenScene.add(text)
    push({ kind: 'scene', text })
  }

  // 2. 把外化线索按「来自第几条内心」分组
  const innerSegments = pcInnerSegments(segments, pcName)
  const cueByInner = new Map<number, PcCue[]>()
  for (const cue of exposure?.cues ?? []) {
    const index = clampIndex(cue.fromIndex, innerSegments.length)
    const list = cueByInner.get(index) ?? []
    list.push(cue)
    cueByInner.set(index, list)
  }
  const innerIndexById = new Map<string, number>()
  innerSegments.forEach((segment, index) => innerIndexById.set(segment.id, index))

  // 3. 按原文顺序重建时间线
  const ordered = [...segments].sort((a, b) => a.sourceRange[0] - b.sourceRange[0])
  let playedBeats = 0

  for (const segment of ordered) {
    // 内心不外传，但它的外在表现会插在原来的时间位置
    if (segment.kind === 'inner') {
      const index = innerIndexById.get(segment.id)
      if (index === undefined) continue
      for (const cue of cueByInner.get(index) ?? []) {
        push({ kind: 'pc-cue', characterName: pcName, text: cue.visible.trim(), locked: true })
      }
      continue
    }

    if (SCENE_KINDS.has(segment.kind)) {
      const text = segment.text.trim()
      if (!text || seenScene.has(text)) continue
      seenScene.add(text)
      push({ kind: 'scene', text })
      continue
    }

    if (segment.kind === 'speech') {
      const text = segment.text.trim()
      if (!text) continue
      playedBeats += 1
      if (segment.speaker === pcName) {
        push({ kind: 'pc-speech', characterName: pcName, text, locked: true })
      } else {
        push({
          kind: 'speech',
          characterId: segment.speaker ? cardByName.get(segment.speaker)?.id : undefined,
          characterName: segment.speaker ?? undefined,
          text,
        })
      }
      continue
    }

    if (segment.kind === 'action') {
      const text = segment.text.trim()
      if (!text) continue
      playedBeats += 1
      const isMine = segment.subject?.includes(pcName)
      const subject = segment.subject?.[0]
      push({
        kind: isMine ? 'pc-action' : 'action',
        characterId: isMine ? undefined : subject ? cardByName.get(subject)?.id : undefined,
        characterName: isMine ? pcName : subject,
        text,
        locked: isMine || undefined,
      })
    }
  }

  // 4. 素材里没有具体演出（概要模式）时，用场景构建展开出来的节拍补上
  if (!playedBeats) {
    for (const beat of sceneSetup.establishedBeats) {
      const text = beat.text.trim()
      if (!text) continue

      if (beat.character === pcName) {
        push({
          kind: beat.kind === 'speech' ? 'pc-speech' : 'pc-action',
          characterName: pcName,
          text,
          locked: true,
        })
        continue
      }
      if (beat.kind === 'scene') {
        if (seenScene.has(text)) continue
        seenScene.add(text)
        push({ kind: 'scene', text })
        continue
      }
      push({
        kind: beat.kind === 'speech' ? 'speech' : 'action',
        characterId: beat.character ? cardByName.get(beat.character)?.id : undefined,
        characterName: beat.character,
        text,
      })
    }
  }

  // 5. 保险丝：如果前面漏掉了你写的内容，在这里补回来（不会重复已有的节拍）
  const alreadyOut = (text: string) =>
    blocks.some((block) => block.text.includes(text) || text.includes(block.text))
  for (const segment of ordered) {
    const isMine = segment.speaker === pcName || segment.subject?.includes(pcName)
    if (!isMine) continue
    if (segment.kind !== 'speech' && segment.kind !== 'action') continue
    const text = segment.text.trim()
    if (!text || alreadyOut(text)) continue
    push({
      kind: segment.kind === 'speech' ? 'pc-speech' : 'pc-action',
      characterName: pcName,
      text,
      locked: true,
    })
  }

  // 6. 兜底：外化线索如果没能在时间线里找到落脚点（例如概要模式下没有对应的内心片段），
  //    就在你的内容之后补上 —— 不能让你写下的情绪完全没被看到
  const emittedCues = new Set(blocks.filter((block) => block.kind === 'pc-cue').map((block) => block.text))
  for (const cue of exposure?.cues ?? []) {
    const text = cue.visible.trim()
    if (!text || emittedCues.has(text)) continue
    emittedCues.add(text)
    push({ kind: 'pc-cue', characterName: pcName, text, locked: true })
  }

  // 7. 世界自己发生的事 —— 排在你写的内容之后、角色反应之前。
  //    它是「离了用户剧情也能继续走」的那一步：狼扑上来、火灭了、对方失去耐心。
  for (const event of situation?.events ?? []) {
    const text = event.text.trim()
    if (!text) continue
    push({ kind: 'world', text })
  }

  // 8. 各角色 AI 的新反应（发生在上面这一切之后）
  for (const roleplay of roleplays) {
    for (const beat of roleplay.beats) {
      push({
        kind: beat.kind,
        characterId: roleplay.characterId,
        characterName: roleplay.name,
        text: beat.text,
      })
    }
  }

  const reactions: ReactionCard[] = roleplays.map((roleplay) => {
    const card = cards.find((item) => item.id === roleplay.characterId)
    return {
      characterId: roleplay.characterId,
      name: roleplay.name,
      tier: card?.tier ?? 'minor',
      beats: roleplay.beats,
      inner: roleplay.inner,
      mood: roleplay.mood,
      silentReason: roleplay.silentReason,
    }
  })

  return { blocks, reactions, pcName }
}
