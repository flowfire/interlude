import type {
  CharacterCard,
  ComposedScene,
  ContextBundle,
  HistoryRound,
  PerceivedEvent,
  RoleplayOutput,
  SceneBlock,
} from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { Round, Step } from '@/types/step'

/**
 * 往事的总长度上限（字符数，粗算 1 字符 ≈ 0.6 token）。
 *
 * 到上限时的做法是「砍掉最早的部分并注明」，压缩策略还没做 ——
 * 这是有意的：先把累加做对，等真的撞到上限再决定怎么压。
 */
export const HISTORY_MAX_CHARS = 24000

function findStep(steps: Record<string, Step>, roundId: string, stage: Step['stage'], characterId?: string): Step | undefined {
  return Object.values(steps)
    .filter((step) => step.roundId === roundId && step.stage === stage && step.status === 'done')
    .filter((step) => !characterId || (step.meta?.characterId as string | undefined) === characterId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop()
}

/**
 * 他当时在不在场。
 *
 * 判断依据是**那一轮的场面**，不是"有没有跑过给他组装上下文的步骤"——
 * 后者会被重跑、清空影响，而场面是已经定下来的事实。
 */
function wasPresent(sceneSetup: SceneSetup | undefined, card: CharacterCard): boolean {
  if (!sceneSetup) return false
  const names = new Set([card.name, ...(card.aliases ?? [])])
  return (sceneSetup.present ?? []).some((item) => names.has(item.name))
}

function absentRound(index: number): HistoryRound {
  return {
    index,
    absent: true,
    time: '',
    place: '',
    atmosphere: '',
    pressure: '',
    escalation: '',
    interludeSummary: '',
    interludeMine: '',
    pcProfile: '',
    presentNames: [],
    sceneLines: [],
    events: [],
    inner: '',
  }
}

/**
 * 把「那一轮真正发给他的那一份上下文」变成往事的一段。
 *
 * 注意这里用的是 **context 步骤的产物**，而不是编排出来的完整剧本：
 * 那份上下文里已经包含了当时的感知判定（谁的话他听到了、什么他漏看了），
 * 也**只有他该知道的东西**。别人的言行从来不在里面，所以不会混进他的记忆。
 *
 * 唯一要补的是**他自己当时说的话、做的事** —— 那是一定知道的，
 * 而它不在感知候选池里（AI 的反应是并发生成的）。
 */
function roundFromBundle(input: {
  round: Round
  bundle: ContextBundle
  roleplay?: RoleplayOutput
  /** 这一轮在他**之后**行动的人说了什么做了什么 */
  laterBeats?: PerceivedEvent[]
}): HistoryRound {
  const { round, bundle, roleplay, laterBeats = [] } = input

  const ownBeats: PerceivedEvent[] = (roleplay?.beats ?? [])
    .map((beat) => ({ kind: beat.kind, from: bundle.name, text: beat.text, self: true }))
    .filter((event) => event.text.trim().length > 0)

  return {
    index: round.index,
    time: bundle.scene.time,
    place: bundle.scene.place,
    atmosphere: bundle.scene.atmosphere,
    interludeSummary: bundle.interlude?.summary ?? '',
    interludeMine: bundle.interlude?.mine ?? '',
    pressure: bundle.pressure ?? '',
    escalation: bundle.escalation ?? '',
    pcProfile: bundle.counterpartProfile,
    presentNames: bundle.presentNames,
    sceneLines: bundle.sceneLines,
    // 顺序就是时间顺序：他之前发生的事（已在 perceived 里）→ 他自己 → 他之后的人。
    // 他当时就在场，所以后面那些人的言行他也看见了 —— 只是当时还没轮到他们。
    events: [...bundle.perceived, ...ownBeats, ...laterBeats],
    inner: roleplay?.inner?.trim() ?? '',
  }
}

export interface HistoryInput {
  rounds: Round[]
  steps: Record<string, Step>
  card: CharacterCard
  pcName: string
  sessionId: string
  currentRoundId: string
  maxChars?: number
}

/**
 * 同一个人这一轮里，**在他之后**行动的那些人的言行。
 *
 * 同一轮里角色是按在场的顺序逐个演绎的：他看得见排在他后面的人做了什么，
 * 因为那些人也是当着大家的面做的 —— 只是那一刻还没轮到他们而已。
 * 他自己之前的人不用在这里补：那些已经进过他的上下文了。
 */
function laterBeatsOf(steps: Record<string, Step>, roundId: string, characterId: string): PerceivedEvent[] {
  const cast = Object.values(steps)
    .filter((step) => step.roundId === roundId && step.stage === 'cast' && step.status === 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop()
  const order = ((cast?.output as { characters?: CharacterCard[] } | undefined)?.characters ?? []).map(
    (item) => item.id,
  )
  const ownIndex = order.indexOf(characterId)
  if (ownIndex < 0) return []

  const later = Object.values(steps)
    .filter((step) => step.roundId === roundId && step.stage === 'roleplay' && step.status === 'done')
    .filter((step) => order.indexOf(String(step.meta?.characterId ?? '')) > ownIndex)
    .sort(
      (a, b) =>
        order.indexOf(String(a.meta?.characterId ?? '')) - order.indexOf(String(b.meta?.characterId ?? '')),
    )

  const out: PerceivedEvent[] = []
  for (const step of later) {
    const output = step.output as RoleplayOutput | undefined
    const name = String(step.meta?.characterName ?? output?.name ?? '有人')
    for (const beat of output?.beats ?? []) {
      const text = beat.text.trim()
      if (!text) continue
      out.push({ kind: beat.kind, from: name, text, self: false })
    }
  }
  return out
}

/**
 * 这个角色「亲身经历过的」往事：一轮一段，按时间顺序，从第 1 轮一路累加。
 *
 * 超出上限时从**最早**的轮次开始丢（保留离现在最近的），并在开头注明。
 * 滑动窗口会破坏角色一致性，所以这里刻意不设「只看最近 N 轮」。
 */
/**
 * 这个角色「亲身经历过的」往事：一轮一段，按时间顺序，从第 1 轮一路累加。
 *
 * 两条硬规则：
 * 1. **他不在场的那一轮，内容一个字都不给**，只留一行「你不在这里」。
 *    连续的几轮会合并成一行。
 * 2. **别人说的话做的事不进他的往事。** 每一段都取那一轮真正发给他的
 *    那份上下文（已经过感知判定），再补上他自己当时的言行。
 *
 * 超出上限时从**最早**的轮次开始丢（保留离现在最近的），并在开头注明。
 */
export function collectHistory(input: HistoryInput): HistoryRound[] {
  const { rounds, steps, card, pcName, sessionId, currentRoundId } = input
  const current = rounds.find((round) => round.id === currentRoundId)
  if (!current) return []

  const past = rounds
    .filter((round) => round.sessionId === sessionId && round.id !== currentRoundId && round.index < current.index)
    .sort((a, b) => a.index - b.index)

  const built: HistoryRound[] = []
  for (const round of past) {
    const sceneSetup = findStep(steps, round.id, 'scene')?.output as SceneSetup | undefined

    if (!wasPresent(sceneSetup, card)) {
      const last = built[built.length - 1]
      if (last?.absent) {
        last.absentThrough = round.index
        continue
      }
      built.push(absentRound(round.index))
      continue
    }

    const bundle = findStep(steps, round.id, 'context', card.id)?.output as ContextBundle | undefined
    if (!bundle) {
      // 他在场，但那一轮的上下文已经不在了（被重跑清掉）。宁可留个空壳，
      // 也不要把这一轮错并进前后的「你不在场」里。
      built.push({ ...absentRound(round.index), absent: false })
      continue
    }

    built.push(
      roundFromBundle({
        round,
        bundle,
        roleplay: findStep(steps, round.id, 'roleplay', card.id)?.output as RoleplayOutput | undefined,
        laterBeats: laterBeatsOf(steps, round.id, card.id),
      }),
    )
  }

  void pcName
  return trimToBudget(built, input.maxChars ?? HISTORY_MAX_CHARS)
}

function roundChars(round: HistoryRound): number {
  return renderHistoryRound(round).length + 2
}

/** 超预算就从最早的开始丢，直到装得下 */
function trimToBudget(rounds: HistoryRound[], maxChars: number): HistoryRound[] {
  let total = rounds.reduce((sum, round) => sum + roundChars(round), 0)
  let start = 0
  while (start < rounds.length && total > maxChars) {
    total -= roundChars(rounds[start])
    start += 1
  }
  return rounds.slice(start)
}

/** 舞台上的一条，渲染成人类读的句子 —— 往事与当前轮共用同一套写法 */
export function renderEventLine(event: PerceivedEvent, order: number): string {
  const who = event.self ? '你' : event.from
  if (event.kind === 'speech') return `${order}. ${who}：「${event.text}」`
  if (event.kind === 'action') return `${order}. ${who}：${event.text}`
  return `${order}. （${who}的样子）${event.text}`
}

/**
 * 一轮的正文：时间地点 + 场面 + 环境 + 依次发生的事。
 *
 * **往事与当前轮共用这一个函数** —— 这是「同一个角色跨轮命中前缀」的关键：
 * 第 K 轮发出去的这一段，必须和第 K+1 轮回看时的这一段逐字节一样。
 */
export function renderRoundBody(round: {
  index: number
  time: string
  place: string
  atmosphere?: string
  interludeSummary?: string
  interludeMine?: string
  pressure?: string
  escalation?: string
  pcProfile?: string
  presentNames?: string[]
  pcName?: string
  sceneLines: string[]
  events: PerceivedEvent[]
}): string {
  const where = [round.time, round.place].filter(Boolean).join(' · ')
  const parts: string[] = [`── 第 ${round.index} 轮${where ? ` · ${where}` : ''} ──`]

  if (round.interludeSummary?.trim()) parts.push(`【这之前】${round.interludeSummary.trim()}`)
  if (round.interludeMine?.trim()) parts.push(`【这段时间你在做什么】${round.interludeMine.trim()}`)
  if (round.atmosphere) parts.push(`【气氛】${round.atmosphere}`)
  if (round.pressure) parts.push(`【局面】${round.pressure}`)
  if (round.escalation) parts.push(`【如果没人动，接下去会发生什么】${round.escalation}`)
  if (round.pcProfile?.trim()) parts.push(`【你对面的人】「${round.pcName ?? '你对面的人'}」—— ${round.pcProfile}`)
  if (round.presentNames?.length) parts.push(`【在场的人】${round.presentNames.join('、')}`)

  if (round.sceneLines.length) {
    parts.push(`【你眼前的环境】\n${round.sceneLines.map((line) => `〔场景〕${line}`).join('\n')}`)
  }
  if (round.events.length) {
    parts.push(
      `【你实际接收到的事（按时间顺序）】\n${round.events
        .map((event, index) => renderEventLine(event, index + 1))
        .join('\n')}\n\n` +
        '这些是**依次发生**的，不是同时发生的 —— 没轮到你的时候你只是看着、听着。',
    )
  }
  return parts.join('\n\n')
}

/** 往事里的一轮，连同他当时心里在想什么 */
export function renderHistoryRound(round: HistoryRound, pcName = '你对面的人'): string {
  if (round.absent) {
    const span =
      round.absentThrough && round.absentThrough > round.index
        ? `第 ${round.index} 轮 ~ 第 ${round.absentThrough} 轮`
        : `第 ${round.index} 轮`
    return `── ${span}：你不在这里 ──`
  }

  const body = renderRoundBody({ ...round, pcName })
  return round.inner ? `${body}\n\n（你当时在想：${round.inner}）` : body
}

/**
 * 共享版前文（给拆解 / 场面 / 阵容三个阶段消歧用）。
 *
 * 不按视角过滤 —— 那三步要判断的是「用户这句话在说谁」，
 * 需要的是完整剧情，而不是某一个角色看到的那一份。
 */
export function renderSharedRecap(scene: ComposedScene | undefined, fallback: string): string {
  if (!scene?.blocks?.length) return fallback.trim()
  return scene.blocks.map(renderBlockForRecap).join('\n')
}

function renderBlockForRecap(block: SceneBlock): string {
  switch (block.kind) {
    case 'scene':
      return `〔场景〕${block.text}`
    case 'world':
      return `〔局面〕${block.text}`
    case 'pc-speech':
      return `我：「${block.text}」`
    case 'pc-action':
      return `我：${block.text}`
    case 'pc-cue':
      return `（我的样子）${block.text}`
    case 'speech':
      return `${block.characterName ?? '某人'}：「${block.text}」`
    case 'action':
      return `${block.characterName ?? '某人'}：${block.text}`
    case 'cue':
      return `（${block.characterName ?? '某人'}的样子）${block.text}`
    default:
      return block.text
  }
}
