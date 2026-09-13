import type {
  CharacterCard,
  ContextBundle,
  HistoryRound,
  PerceiveCandidateRecord,
  PerceiveChannel,
  PerceivedEvent,
} from '@/types/character'
import type { ObservedCue } from '@/types/exposure'
import type { MemoryEntry } from '@/types/memory'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'

/** 这个角色这一轮对信息的接收情况（来自信息分发层） */
export interface Reception {
  missed: { ref: number; why: string }[]
  distorted: { ref: number; as: string }[]
  extras: { text: string; channel: PerceiveChannel; certainty: number }[]
  /** 转述：这条信息在他眼里该怎么念（见 PerceptionEntry.rendered） */
  rendered?: { ref: number; who?: string; as?: string }[]
  note?: string
}

export interface ContextBuildInput {
  card: CharacterCard
  /** 这是第几轮 */
  roundIndex?: number
  segments: Segment[]
  cards: CharacterCard[]
  pcName: string
  /** 用户自己写的人设 —— 原样带进 bundle，角色和导演都要看到 */
  pcPersona?: string
  sceneSetup: SceneSetup
  /** 前几轮已经演过的内容（跨角色共享，给拆解 / 场面 / 阵容三个阶段的消歧用） */
  recap?: string
  /** 这个角色亲身经历过的往事，一轮一段，按时间顺序累加 */
  history?: HistoryRound[]
  /** 这一轮的局面（世界自己往前走的那一步） */
  situation?: { pressure: string; escalation: string }
  /** 导演点到他头上的指令（只在僵局时出现） */
  /** 导演交给他的这一轮任务 */
  direction?: { push: string; act?: string; noInteract?: boolean }
  /**
   * 这一轮**在他之前**行动的人已经说了什么、做了什么。
   *
   * 同一轮里角色是逐个演绎的，所以后开口的人看得到先开口的人 ——
   * 时间顺序上就是如此，这不是"泄漏"，是常识。
   */
  earlierBeats?: PerceivedEvent[]
  /** 这一轮被分发出去的信息（带编号） */
  candidates?: PerceiveCandidateRecord[]
  /** 这个角色对上面这些信息的接收情况 */
  reception?: Reception
  /** 从「你」的内心外化出来的可见表现（不含你的真实想法） */
  pcCues?: ObservedCue[]
  /** 这个角色以前轮次留下的记忆（按时间顺序） */
  memories?: MemoryEntry[]
}

/**
 * 候选池里的文本是给「信息分发」那个模型看的，说话人一律被套上了
 * 「谁：」或「谁：「…」」的壳（pc 那一侧写成「你：」）。
 * 而舞台上本来就是按人分好的，直接拿去渲染会变成「我：「你：「…」」」、
 * 「林砚：林砚：…」这种双重前缀，所以这里按说话人把壳剥掉。
 */
function stripSpeakerWrapper(text: string, from: string | undefined, pcName: string, kind: string): string {
  if (kind !== 'speech' && kind !== 'action') return text

  const prefixes = [from, from === pcName ? '你' : ''].filter((item): item is string => Boolean(item))
  for (const who of prefixes) {
    if (text.startsWith(`${who}：「`) && text.endsWith('」')) {
      return text.slice(who.length + 2, -1)
    }
    if (text.startsWith(`${who}：`)) {
      return text.slice(who.length + 1)
    }
  }
  return text
}

function mentionsSelf(segment: Segment, name: string): boolean {
  if (segment.speaker === name) return true
  if (segment.subject?.includes(name)) return true
  return false
}

/**
 * 按「他实际接收到的那一份」重建时间线。
 *
 * 这是 S4 的核心：角色看到的不是全场，而是信息分发层为他筛过的那一份 ——
 * 漏看的、听岔的，都在这一层体现。台词原文由编号从候选池取回，不会被转述走样。
 */
/**
 * 他在别人眼里叫什么。
 *
 * 用户把自己的角色叫「我」（默认），但对场上其他人来说，那个人是**「他」**——
 * 不能让他们在时间线上读到「我：我抬头看了你一眼」，那会让他们以为是自己做的。
 * 用户要是填了真名，就直接用真名。
 */
export function speakerLabel(from: string | undefined, pcName: string): string {
  if (!from) return '有人'
  if (from !== pcName) return from
  return pcName === '我' ? '他' : pcName
}

function buildPerceived(input: {
  candidates: PerceiveCandidateRecord[]
  reception?: Reception
  card: CharacterCard
  pcName: string
}): { perceived: PerceivedEvent[]; sceneLines: string[] } {
  const { candidates, reception, card, pcName } = input

  const missed = new Set((reception?.missed ?? []).map((item) => item.ref))
  const distorted = new Map((reception?.distorted ?? []).map((item) => [item.ref, item.as]))
  const rendered = new Map((reception?.rendered ?? []).map((item) => [item.ref, item]))

  const perceived: PerceivedEvent[] = []
  const sceneLines: string[] = []

  for (const item of candidates) {
    if (missed.has(item.ref)) continue
    const view = rendered.get(item.ref)
    // 台词绝不转述内容 —— 引号里是用户写的原话，一个字都不能改。
    // 这里再挡一次，不依赖上游有没有把 as 过滤干净（双保险）。
    const as = item.kind === 'speech' ? undefined : view?.as
    // 转述优先：同一条信息，被看的人和旁观的人看到的说法不一样
    const raw = as ?? distorted.get(item.ref) ?? item.text
    const text = as ?? stripSpeakerWrapper(raw, item.from, pcName, item.kind)
    const from = view?.who?.trim() || speakerLabel(item.from, pcName)

    switch (item.kind) {
      case 'scene':
      case 'ambient':
        sceneLines.push(text)
        break
      case 'speech':
        perceived.push({ kind: 'speech', from, text, self: item.from === card.name })
        break
      case 'action':
        perceived.push({ kind: 'action', from, text, self: item.from === card.name })
        break
      case 'cue':
        perceived.push({ kind: 'cue', from, text, self: false })
        break
      case 'event':
        // 世界自己发生的事：没有人在做它，所以没有人称
        perceived.push({ kind: 'event', from: '', text, self: false })
        break
      case 'inner':
        // 引擎已强制把这一条加进没有读取能力者的 missed，能走到这里的都是有能力的
        perceived.push({ kind: 'cue', from, text: `（你读到的念头）${text}`, self: false })
        break
      default:
        break
    }
  }

  return { perceived, sceneLines }
}

/**
 * S4：为某一个角色组装私有上下文包。
 *
 * 五条不可违反的规则：
 * 1. 别人的 inner 绝不进入他的上下文 —— 只有读心类能力能拿到，且要经过信息分发层
 * 2. 用户填写的自我人设（内心层面）也不给他看，只给「看得见的那个人的样子」
 * 3. 他拿到的是**信息分发层为他筛过的那一份**，不是全场
 * 4. 他自己的台词与动作会作为「你已经表现过的」告诉他，避免重复演出
 * 5. 感知按时间顺序排列 —— 用户是按顺序写的，角色也该按顺序经历
 */
export function buildContextBundle(input: ContextBuildInput): ContextBundle {
  const {
    card,
    roundIndex = 0,
    segments,
    cards,
    pcName,
    pcPersona,
    sceneSetup,
    memories = [],
    pcCues = [],
    candidates = [],
    reception,
    earlierBeats = [],
    recap = '',
    history = [],
    situation,
    direction,
  } = input
  void cards

  const presentNames = [pcName, ...sceneSetup.present.map((item) => item.name)].filter(
    (name, index, list) => name && list.indexOf(name) === index,
  )

  const ownThoughts: string[] = []
  const knownFacts: string[] = []
  const doesNotKnow = new Set<string>()

  for (const segment of segments) {
    if (segment.kind === 'inner' && mentionsSelf(segment, card.name)) {
      ownThoughts.push(segment.text)
      continue
    }
    // 世界观设定属于常识层，不走分发
    if (segment.kind === 'worldfact' || segment.kind === 'offscreen') {
      knownFacts.push(segment.text)
    }
  }

  const { perceived, sceneLines } = buildPerceived({ candidates, reception, card, pcName })

  // 先发生的事在前，后面才是先开口的那些人 —— 时间顺序不能乱
  const timeline: PerceivedEvent[] = [
    ...perceived,
    ...earlierBeats.map((event) => ({ ...event, self: event.from === card.name })),
  ]

  // 分发层漏掉的内心，仍然要在「你不知道」里说明白
  const missedInner = new Set(
    (reception?.missed ?? [])
      .filter((item) => candidates.find((candidate) => candidate.ref === item.ref)?.kind === 'inner')
      .map((item) => item.ref),
  )
  if ([...missedInner].length || !card.mindReading.trim()) {
    doesNotKnow.add(
      card.mindReading.trim()
        ? `${pcName}此刻没说出口的东西（他藏得比你读得到的更深）`
        : `${pcName}的真实想法、来历和底牌（你只能凭他的样子和表现去判断）`,
    )
  }
  for (const segment of segments) {
    if (segment.kind !== 'inner') continue
    const owner = segment.subject?.[0]
    if (!owner || owner === pcName || owner === card.name) continue
    doesNotKnow.add(`${owner}心里在想什么（你只能从他的表情、语气、动作去猜，而且可能猜错）`)
  }

  // 从感知结果派生出的分类视图（UI 与记忆用）
  const heard = timeline
    .filter((event) => event.kind === 'speech' && !event.self)
    .map((event) => ({ from: event.from, text: event.text }))
  const seen = timeline
    .filter((event) => event.kind === 'action' && !event.self)
    .map((event) => ({ subject: event.from, text: event.text }))
  const ownPriorLines = timeline
    .filter((event) => event.self)
    .map((event) => (event.kind === 'speech' ? `你说过：「${event.text}」` : `你做过：${event.text}`))

  return {
    characterId: card.id,
    name: card.name,
    card,
    roundIndex,
    pcName,
    counterpartProfile: sceneSetup.pcProfile || '（没有额外描写，你只能看到眼前这个人本身）',
    presentNames,
    recap,
    history,
    direction,
    interlude: sceneSetup.interlude
      ? {
          summary: sceneSetup.interlude.summary,
          mine: sceneSetup.interlude.each.find((item) => item.who === card.name)?.what,
        }
      : undefined,
    pressure: situation?.pressure ?? '',
    escalation: situation?.escalation ?? '',
    scene: {
      time: sceneSetup.time,
      place: sceneSetup.place,
      atmosphere: sceneSetup.atmosphere,
    },
    perceived: timeline,
    sceneLines,
    heard,
    seen,
    ownThoughts,
    ownPriorLines,
    extras: reception?.extras ?? [],
    pcCues,
    knownFacts,
    doesNotKnow: [...doesNotKnow],
    recalled: memories ?? [],
  }
}
