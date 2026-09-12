import type { CharacterCard, ContextBundle, PerceivedEvent } from '@/types/character'
import type { ObservedCue } from '@/types/exposure'
import type { MemoryEntry } from '@/types/memory'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'

export interface ContextBuildInput {
  card: CharacterCard
  segments: Segment[]
  cards: CharacterCard[]
  pcName: string
  sceneSetup: SceneSetup
  /** 从「你」的内心外化出来的可见表现（不含你的真实想法） */
  pcCues?: ObservedCue[]
  /**
   * 他**实际读到**的内心 —— 由独立的「读取判定」阶段给出。
   * 注意这里传进来的是判定结果，不是对方的原始内心。
   */
  mindRead?: { text: string; certainty: number }[]
  /** 这个角色以前轮次留下的记忆（按时间顺序） */
  memories?: MemoryEntry[]
}

function mentionsSelf(segment: Segment, name: string): boolean {
  if (segment.speaker === name) return true
  if (segment.subject?.includes(name)) return true
  return false
}

/**
 * S4：为某一个角色组装私有上下文包。
 *
 * 五条不可违反的规则：
 * 1. 别人的 inner 绝不进入他的上下文 —— 只会变成一句「你不知道…」
 * 2. 用户填写的自我人设（内心层面）也不给他看，只给「看得见的那个人的样子」
 * 3. 你自己的内心不外传，但它的外在表现会**插回原本的时间位置**给他
 * 4. 他自己的台词与动作会作为「你已经表现过的」告诉他，避免重复演出
 * 5. **感知按时间顺序排列** —— 用户是按顺序写的，角色也该按顺序经历
 */
export function buildContextBundle(input: ContextBuildInput): ContextBundle {
  const { card, segments, cards, pcName, sceneSetup, memories = [], pcCues = [], mindRead = [] } = input
  void cards

  const presentNames = [pcName, ...sceneSetup.present.map((item) => item.name)].filter(
    (name, index, list) => name && list.indexOf(name) === index,
  )

  const sceneLines: string[] = []
  const heard: ContextBundle['heard'] = []
  const seen: ContextBundle['seen'] = []
  const ownThoughts: string[] = []
  const ownPriorLines: string[] = []
  const knownFacts: string[] = []
  const doesNotKnow = new Set<string>()
  const perceived: PerceivedEvent[] = []

  // 内心片段按原文顺序编号，好把外化线索插回正确的时间位置
  const innerOrder = [...segments]
    .filter((segment) => segment.kind === 'inner')
    .sort((a, b) => a.sourceRange[0] - b.sourceRange[0])
  const innerIndexById = new Map<string, number>()
  innerOrder.forEach((segment, index) => innerIndexById.set(segment.id, index))

  const cuesByInner = new Map<number, ObservedCue[]>()
  for (const cue of pcCues) {
    const list = cuesByInner.get(cue.fromIndex) ?? []
    list.push(cue)
    cuesByInner.set(cue.fromIndex, list)
  }

  const ordered = [...segments].sort((a, b) => a.sourceRange[0] - b.sourceRange[0])

  for (const segment of ordered) {
    const isSelf = mentionsSelf(segment, card.name)

    switch (segment.kind) {
      case 'scene':
      case 'ambient':
      case 'narration': {
        sceneLines.push(segment.text)
        break
      }
      case 'worldfact':
      case 'offscreen': {
        knownFacts.push(segment.text)
        break
      }
      case 'speech': {
        const from = segment.speaker ?? '（不明）'
        if (isSelf) {
          ownPriorLines.push(`你说过：「${segment.text}」`)
        } else {
          heard.push({ from, text: segment.text })
        }
        perceived.push({ kind: 'speech', from, text: segment.text, self: isSelf })
        break
      }
      case 'action': {
        const from = segment.subject?.[0] ?? '有人'
        if (isSelf) {
          ownPriorLines.push(`你做过：${segment.text}`)
        } else {
          seen.push({ subject: from, text: segment.text })
        }
        perceived.push({ kind: 'action', from, text: segment.text, self: isSelf })
        break
      }
      case 'inner': {
        if (isSelf) {
          ownThoughts.push(segment.text)
          break
        }

        const owner = segment.subject?.[0]
        const isPcInner = !owner || owner === pcName

        // 有读取能力的角色，走的是独立的「读取判定」阶段 ——
        // 对方的原文**不会**流到这里，他拿到的只有判定结果。
        if (card.mindReading.trim() && isPcInner) break

        doesNotKnow.add(`${owner ?? '有人'}心里在想什么（你只能从他的表情、语气、动作去猜，而且可能猜错）`)

        // 不是他的内心，但如果这就是「你」的内心，它的外在表现会出现在这里
        const index = innerIndexById.get(segment.id)
        if (index === undefined) break
        for (const cue of cuesByInner.get(index) ?? []) {
          perceived.push({ kind: 'cue', from: pcName, text: cue.visible, self: false })
        }
        break
      }
      default:
        break
    }
  }

  // 你填写的自我人设属于「内心层面」，绝不外泄；对方只能看到场景构建归纳出的外在形象。
  // 有读心能力的角色是例外 —— 但也只是「有可能读到念头」，来历和底牌依然看不到。
  doesNotKnow.add(
    card.mindReading.trim()
      ? `${pcName}更深的来历和底牌（你的能力最多只覆盖到念头这一层）`
      : `${pcName}的真实想法、来历和底牌（你只能凭他的样子和表现去判断）`,
  )

  return {
    characterId: card.id,
    name: card.name,
    card,
    pcName,
    counterpartProfile: sceneSetup.pcProfile || '（没有额外描写，你只能看到眼前这个人本身）',
    presentNames,
    scene: {
      time: sceneSetup.time,
      place: sceneSetup.place,
      atmosphere: sceneSetup.atmosphere,
      situation: sceneSetup.situation,
      opening: sceneSetup.opening,
    },
    perceived,
    sceneLines,
    heard,
    seen,
    ownThoughts,
    ownPriorLines,
    mindRead,
    pcCues,
    knownFacts,
    doesNotKnow: [...doesNotKnow],
    recalled: memories ?? [],
  }
}
