import type {
  CharacterCard,
  ComposedScene,
  HistoryRound,
  PerceiveCandidateRecord,
  PerceivedEvent,
  PerceptionOutcome,
  RoleplayOutput,
  SceneBlock,
} from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { SituationState } from '@/types/situation'
import type { Round, Step } from '@/types/step'
import type { Reception } from './stages/s4-context'

/**
 * 往事的总长度上限（字符数，粗算 1 字符 ≈ 0.6 token）。
 *
 * 到上限时的做法是「砍掉最早的部分并注明」，压缩策略还没做 ——
 * 这是有意的：先把累加做对，等真的撞到上限再决定怎么压。
 */
export const HISTORY_MAX_CHARS = 24000

/** 候选人池里的文本带着「谁：」或「谁：「」的壳，剥掉它才能和舞台上的原文对上 */
function payloadOf(text: string): string {
  const quoted = text.match(/^[^：\n]{1,24}：「([\s\S]*)」$/)
  if (quoted) return quoted[1]
  const plain = text.match(/^[^：\n]{1,24}：([\s\S]*)$/)
  if (plain) return plain[1]
  return text
}

interface Override {
  missed?: boolean
  as?: string
}

/**
 * 把「信息分发层对这一轮的判定」整理成一张按文本查的表。
 *
 * 舞台上的块和候选池里的条目来自同一段原文，所以按文本能对上：
 * 被判定为没接收到的就整块删掉，被判定为听岔的换成分发层给出的版本。
 */
function overridesOf(candidates: PerceiveCandidateRecord[], reception?: Reception): Map<string, Override> {
  const missed = new Set((reception?.missed ?? []).map((item) => item.ref))
  const distorted = new Map((reception?.distorted ?? []).map((item) => [item.ref, item.as]))
  const out = new Map<string, Override>()

  for (const candidate of candidates) {
    const keys = new Set([candidate.text, payloadOf(candidate.text)])
    for (const key of keys) {
      if (!key.trim()) continue
      const current = out.get(key) ?? {}
      if (missed.has(candidate.ref)) current.missed = true
      const as = distorted.get(candidate.ref)
      if (as) current.as = as
      out.set(key, current)
    }
  }

  return out
}

function applyOverride(text: string, overrides: Map<string, Override>): { dropped: boolean; text: string } {
  const found = overrides.get(text) ?? overrides.get(payloadOf(text))
  if (!found) return { dropped: false, text }
  if (found.missed) return { dropped: true, text }
  return { dropped: false, text: found.as ?? text }
}

function findStep(steps: Record<string, Step>, roundId: string, stage: Step['stage'], characterId?: string): Step | undefined {
  return Object.values(steps)
    .filter((step) => step.roundId === roundId && step.stage === stage && step.status === 'done')
    .filter((step) => !characterId || (step.meta?.characterId as string | undefined) === characterId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop()
}

/** 当时在场的人 —— 与当前轮的算法保持一致（pc 打头，去重） */
function presentNamesOf(sceneSetup: SceneSetup | undefined, pcName: string): string[] {
  return [pcName, ...(sceneSetup?.present ?? []).map((item) => item.name)].filter(
    (name, index, list) => name && list.indexOf(name) === index,
  )
}

function eventOf(name: string, self: boolean, kind: PerceivedEvent['kind'], text: string): PerceivedEvent {
  return { kind, from: name, text, self }
}

/**
 * 从一轮已经跑完的步骤里，重建**某一个角色**当时经历的那一幕。
 *
 * 素材全部来自那一轮的步骤产物，所以重放多少次都是逐字节一样的 ——
 * 这是「同一个角色跨轮命中前缀」的前提。
 */
function rebuildRound(input: {
  round: Round
  sceneSetup?: SceneSetup
  situation?: SituationState
  scene?: ComposedScene
  candidates: PerceiveCandidateRecord[]
  reception?: Reception
  roleplay?: RoleplayOutput
  cardName: string
  pcName: string
}): HistoryRound {
  const { round, sceneSetup, situation, scene, candidates, reception, roleplay, cardName, pcName } = input
  const overrides = overridesOf(candidates, reception)

  const sceneLines: string[] = []
  const events: PerceivedEvent[] = []

  // 开场画面与「正在发生什么」也属于环境，而且它们在候选池里排在环境的最前面。
  // 编排结果里只有开场画面、没有 situation，所以这里按同一顺序补齐，
  // 保证「当时发出去的那一段」和「后来回看的那一段」逐字节一致。
  const opening = new Set<string>()
  for (const line of sceneSetup?.opening ?? []) {
    const text = line.trim()
    if (!text) continue
    opening.add(text)
    const outcome = applyOverride(text, overrides)
    if (!outcome.dropped) sceneLines.push(outcome.text)
  }
  if (sceneSetup?.situation?.trim()) {
    const situation = sceneSetup.situation.trim()
    const outcome = applyOverride(situation, overrides)
    if (!outcome.dropped) sceneLines.push(outcome.text)
  }

  if (scene?.blocks?.length) {
    for (const block of scene.blocks) {
      const outcome = applyOverride(block.text, overrides)
      if (outcome.dropped) continue
      const text = outcome.text

      // 世界自己发生的事也属于「当时的环境」—— 他记得狼扑上来了
      if (block.kind === 'scene' || block.kind === 'world') {
        if (block.kind === 'scene' && opening.has(block.text)) continue
        sceneLines.push(text)
        continue
      }
      const name = block.characterName ?? (block.kind.startsWith('pc-') ? pcName : '有人')
      const kind: PerceivedEvent['kind'] =
        block.kind === 'speech' || block.kind === 'pc-speech'
          ? 'speech'
          : block.kind === 'action' || block.kind === 'pc-action'
            ? 'action'
            : 'cue'
      events.push(eventOf(name, name === cardName, kind, text))
    }
  } else {
    // 还没编排出来（比如只跑了前几步）：退回到用户原文，至少别让他忘掉
    const text = round.userInput.trim()
    if (text) sceneLines.push(text)
  }

  return {
    index: round.index,
    time: sceneSetup?.time ?? '',
    place: sceneSetup?.place ?? '',
    atmosphere: sceneSetup?.atmosphere ?? '',
    pressure: situation?.pressure ?? '',
    escalation: situation?.escalation ?? '',
    pcProfile: sceneSetup?.pcProfile ?? '',
    presentNames: presentNamesOf(sceneSetup, pcName),
    sceneLines,
    events,
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
 * 这个角色「亲身经历过的」往事：一轮一段，按时间顺序，从第 1 轮一路累加。
 *
 * 超出上限时从**最早**的轮次开始丢（保留离现在最近的），并在开头注明。
 * 滑动窗口会破坏角色一致性，所以这里刻意不设「只看最近 N 轮」。
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
    const perception = findStep(steps, round.id, 'perceive')?.output as PerceptionOutcome | undefined
    built.push(
      rebuildRound({
        round,
        sceneSetup: findStep(steps, round.id, 'scene')?.output as SceneSetup | undefined,
        situation: findStep(steps, round.id, 'situation')?.output as SituationState | undefined,
        scene: findStep(steps, round.id, 'compose')?.output as ComposedScene | undefined,
        candidates: perception?.candidates ?? [],
        reception: perception?.entries.find((entry) => entry.characterId === card.id),
        roleplay: findStep(steps, round.id, 'roleplay', card.id)?.output as RoleplayOutput | undefined,
        cardName: card.name,
        pcName,
      }),
    )
  }

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
