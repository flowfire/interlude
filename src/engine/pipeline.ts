import type { LlmClient } from './llm/client'
import { createPool } from './llm/pool'
import { createStep, planRerun, type StepIndex } from './graph/stepGraph'
import { revokeBySteps, type LedgerIndex } from './graph/ledger'
import { normalizeInput, type NormalizedDoc } from './stages/s0-normalize'
import { runSegmentStage, type SegmentStageOutput } from './stages/s1-segment'
import { runSceneStage } from './stages/s2-scene'
import { runExposureStage } from './stages/s2b-exposure'
import { runPerceiveStage } from './stages/s3b-perceive'
import { runSituationStage } from './stages/s3c-situation'
import { runCastStage, type CastStageOutput } from './stages/s3-cast'
import { buildContextBundle } from './stages/s4-context'
import { runRoleplayStage } from './stages/s5-roleplay'
import { composeScene } from './stages/s7-compose'
import { buildRoundMemories, describeWhere, type MemoryBuildInput } from './stages/s8-memory'
import { getCastLibrary, getMemories, recallFor, toKnownCast } from './memory/library'
import { HISTORY_MAX_CHARS, collectHistory, renderSharedRecap } from './history'
import type {
  CharacterCard,
  ComposedScene,
  ContextBundle,
  KnownCastEntry,
  PerceivedEvent,
  PerceptionOutcome,
  RoleplayOutput,
} from '@/types/character'
import type { ObservedCue, PcExposure } from '@/types/exposure'
import type { SituationPace, SituationState } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Round, Step, StepStage } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'
import { nowIso } from '@/utils/time'

export interface PipelineContext {
  client: LlmClient
  project: ProjectSettings
  round: Round
  /** 整个工作区的轮次。用来把角色库与记忆限定在当前这条对话内 */
  rounds?: Round[]
  steps: StepIndex
  ledger: LedgerIndex
  /** 每一步状态变化时回调，UI 用来实时刷新 */
  onUpdate?: (steps: StepIndex, ledger: LedgerIndex) => void
  signal?: AbortSignal
}

/**
 * 当前对话包含哪些轮次。
 * 角色库与记忆都按它隔离 —— 新开一条完全无关的故事线时，
 * 不会凭空认出上一场戏里的角色，也不会记着上一场戏发生过什么。
 *
 * 没拿到完整轮次列表时返回 undefined（表示不做隔离），保持向后兼容。
 */
function sessionRoundIds(ctx: PipelineContext): Set<string> | undefined {
  if (!ctx.rounds?.length) return undefined
  const ids = ctx.rounds
    .filter((round) => round.sessionId === ctx.round.sessionId)
    .map((round) => round.id)
  ids.push(ctx.round.id)
  return new Set(ids)
}

/** 沿依赖向上找最近的某个阶段的步骤 */
export function findUpstreamByStage(steps: StepIndex, stepId: string, stage: StepStage): Step | undefined {
  const seen = new Set<string>()
  const queue = [...(steps[stepId]?.deps ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const step = steps[id]
    if (!step) continue
    if (step.stage === stage) return step
    queue.push(...step.deps)
  }
  return undefined
}

/** 直接上游中某个阶段的全部步骤（顺序与 deps 一致） */
export function upstreamStepsByStage(steps: StepIndex, stepId: string, stage: StepStage): Step[] {
  return (steps[stepId]?.deps ?? [])
    .map((id) => steps[id])
    .filter((step): step is Step => Boolean(step) && step!.stage === stage)
}

/** 找当前对话里上一轮已经完成的场景，用来给这一轮的场景构建提供连续性 */
function findPreviousScene(ctx: PipelineContext): { place: string; situation: string; summary: string } | null {
  const ids = sessionRoundIds(ctx)
  const previous = Object.values(ctx.steps)
    .filter((step) => step.stage === 'scene' && step.status === 'done')
    .filter((step) => (!ids || ids.has(step.roundId)) && step.roundId !== ctx.round.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop()

  const setup = previous?.output as SceneSetup | undefined
  if (!setup) return null
  return {
    place: setup.place || '（未说明）',
    situation: setup.situation || '（未说明）',
    summary: setup.opening.join(' '),
  }
}

/**
 * 当前对话里已经出场过的人。
 *
 * 拆解、场景构建、阵容解析三个阶段都要用它来消歧 ——
 * 用户写「我跟着前面那个人」时，「前面的人」指的是上一轮的金刚狼，
 * 不该被当成一个新人设。
 */
function knownCastOf(ctx: PipelineContext): KnownCastEntry[] {
  return toKnownCast(
    getCastLibrary(ctx.steps, {
      roundIds: sessionRoundIds(ctx),
      excludeRoundId: ctx.round.id,
    }),
  )
}

/**
 * 前文剧情（共享版）。
 *
 * 从第 1 轮一路累加，不再只看最近两轮 —— 滑动窗口省 token，但会把
 * 「他三天前说过的那句话」抹掉，角色一致性先坏在这里。
 * 超出预算才从最早的一轮开始丢，并在开头注明。
 */
function buildRecap(ctx: PipelineContext): string {
  if (!ctx.rounds?.length) return ''

  const previousRounds = ctx.rounds
    .filter((round) => round.sessionId === ctx.round.sessionId && round.index < ctx.round.index)
    .sort((a, b) => a.index - b.index)

  if (!previousRounds.length) return ''

  const parts: string[] = []
  let total = 0

  for (const round of previousRounds) {
    const composeStep = Object.values(ctx.steps).find(
      (step) => step.roundId === round.id && step.stage === 'compose' && step.status === 'done',
    )
    const scene = composeStep?.output as ComposedScene | undefined
    const body = renderSharedRecap(scene, round.userInput)
    const piece = `── 第 ${round.index} 轮 ──\n${body}`
    parts.push(piece)
    total += piece.length + 2
  }

  let start = 0
  while (start < parts.length - 1 && total > HISTORY_MAX_CHARS) {
    total -= parts[start].length + 2
    start += 1
  }

  const text = parts.slice(start).join('\n\n')
  if (!start) return text
  return `（更早的 ${start} 轮已经太长，这里从第 ${previousRounds[start].index} 轮开始）\n${text}`
}

/**
 * 上一轮的局面状态（同一个对话内）。
 *
 * 「压力」是跨轮累积的东西：上一轮埋下的隐患，这一轮该兑现一部分。
 */
/**
 * 成人向已经连着几轮了 —— 这是给导演看的一份「成绩单」。
 *
 * 从当前轮往前数，连续多少轮是 r18（其中多少轮还勾了快速入戏）。
 * 轮数越多，说明导演磨得越久：用户勾成人向不是为了看你铺垫。
 * 界面上不显示，只用来给导演压力。
 */
function r18StreakOf(ctx: PipelineContext): { r18Streak: number; directStreak: number } {
  const list = (ctx.rounds?.length ? ctx.rounds : [ctx.round])
    .filter((round) => round.sessionId === ctx.round.sessionId && round.index <= ctx.round.index)
    .sort((a, b) => b.index - a.index)

  let r18Streak = 0
  let directStreak = 0
  for (const round of list) {
    if ((round.rating ?? 'general') !== 'r18') break
    r18Streak += 1
    if (round.direct) directStreak += 1
  }
  return { r18Streak, directStreak }
}

/**
 * 最近几轮导演自己打的性内容分（按时间顺序）。
 *
 * 回放给它看 —— 它自己就会发现"连着三轮没动"，比外面塞一条命令管用。
 */
function recentSexScores(ctx: PipelineContext): number[] {
  const ids = sessionRoundIds(ctx)
  return Object.values(ctx.steps)
    .filter((item) => item.stage === 'situation' && item.status === 'done')
    .filter((item) => (!ids || ids.has(item.roundId)) && item.roundId !== ctx.round.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-4)
    .map((item) => (item.output as SituationState | undefined)?.sexScore ?? 0)
}

function previousSituation(
  ctx: PipelineContext,
): { pressure: string; escalation: string; pace: SituationPace; recentPaces: SituationPace[] } | null {
  const ids = sessionRoundIds(ctx)
  const steps = Object.values(ctx.steps)
    .filter((item) => item.stage === 'situation' && item.status === 'done')
    .filter((item) => (!ids || ids.has(item.roundId)) && item.roundId !== ctx.round.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const state = steps[steps.length - 1]?.output as SituationState | undefined
  if (!state) return null

  // 最近几轮的节奏 —— 导演靠它判断「这一幕是不是拖太久了，该收了」
  const recentPaces = steps
    .slice(-3)
    .map((step) => (step.output as SituationState | undefined)?.pace ?? 'build')

  return { pressure: state.pressure, escalation: state.escalation, pace: state.pace ?? 'build', recentPaces }
}

/**
 * 按「局面」给出的顺序排列这一轮需要反应的人。
 *
 * 顺序是叙事的一部分（后动的人看得见先动的人），所以引擎只做兜底：
 * 名单里多出来的名字丢掉，漏掉的人按原来的阵容顺序补在最后。
 */
function orderActors(actors: CharacterCard[], order: string[]): CharacterCard[] {
  if (!order.length) return actors

  const byName = new Map<string, CharacterCard>()
  for (const card of actors) {
    byName.set(card.name, card)
    for (const alias of card.aliases ?? []) byName.set(alias, card)
  }

  const out: CharacterCard[] = []
  for (const name of order) {
    const card = byName.get(name)
    if (card && !out.includes(card)) out.push(card)
  }
  for (const card of actors) if (!out.includes(card)) out.push(card)
  return out
}

function emptyCost() {
  return { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 }
}

function elapsed(startedAt: number) {
  return { ...emptyCost(), ms: Math.round(performance.now() - startedAt) }
}

function done<TOut>(step: Step<TOut>, output: TOut, extra: Partial<Step<TOut>> = {}): Step<TOut> {
  return { ...step, output, status: 'done', error: undefined, updatedAt: nowIso(), ...extra }
}

function costOf(result: { usage: { promptTokens: number; completionTokens: number }; ms: number } | null, startedAt: number) {
  return result
    ? { calls: 1, tokensIn: result.usage.promptTokens, tokensOut: result.usage.completionTokens, ms: result.ms }
    : elapsed(startedAt)
}

/** 执行单个步骤（纯逻辑，不负责状态转移） */
async function executeStep(ctx: PipelineContext, step: Step): Promise<Step> {
  const startedAt = performance.now()

  switch (step.stage) {
    case 'normalize': {
      return done(step, normalizeInput(ctx.round.userInput), { cost: elapsed(startedAt) })
    }

    case 'segment': {
      const upstream = findUpstreamByStage(ctx.steps, step.id, 'normalize')
      const doc = (upstream?.output as NormalizedDoc | undefined) ?? normalizeInput(ctx.round.userInput)
      const { output, result } = await runSegmentStage(ctx.client, {
        doc,
        project: ctx.project,
        knownCast: knownCastOf(ctx),
        previousRecap: buildRecap(ctx),
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'scene': {
      const doc = findUpstreamByStage(ctx.steps, step.id, 'normalize')?.output as NormalizedDoc | undefined
      const segmentOutput = findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined
      const segments = segmentOutput?.segments ?? []
      if (!doc) throw new Error('缺少上游的规范化结果')

      const { output, result } = await runSceneStage(ctx.client, {
        doc,
        segments,
        entities: segmentOutput?.entities ?? [],
        project: ctx.project,
        previousScene: findPreviousScene(ctx),
        rating: ctx.round.rating ?? 'general',
        knownCast: knownCastOf(ctx),
        previousRecap: buildRecap(ctx),
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'exposure': {
      const segments = (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments ?? []
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      if (!sceneSetup) throw new Error('缺少上游的场景构建结果')

      const { output, result } = await runExposureStage(ctx.client, {
        segments,
        sceneSetup,
        project: ctx.project,
        rating: ctx.round.rating ?? 'general',
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'cast': {
      const doc = findUpstreamByStage(ctx.steps, step.id, 'normalize')?.output as NormalizedDoc | undefined
      const segments = (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments ?? []
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      if (!doc) throw new Error('缺少上游的规范化结果')
      if (!segments.length) throw new Error('上游拆解没有产出任何片段')

      // 只让「需要单独反应」的人建卡；但如果模型把所有人都标成了「只是背景」，
      // 至少别一个人都不剩 —— 那会导致整轮被判定为「不需要交互」
      const allPresent = sceneSetup?.present ?? []
      const activePresent = allPresent.filter((item) => item.active)
      const present = activePresent.length ? activePresent : allPresent
      // 跨轮角色库：以前出场过的角色直接复用他的卡，保持人设一致，也省一次调用
      // 但限定在当前对话内，并排除本轮自己和之前的产出（重跑时要能重新生成）
      const library = getCastLibrary(ctx.steps, {
        roundIds: sessionRoundIds(ctx),
        excludeRoundId: ctx.round.id,
      })
      const { output, result } = await runCastStage(ctx.client, {
        doc,
        segments,
        project: ctx.project,
        present,
        library,
        enableResearch: ctx.project.researchEnabled,
        knownCast: toKnownCast(library),
        previousRecap: buildRecap(ctx),
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'situation': {
      const doc = findUpstreamByStage(ctx.steps, step.id, 'normalize')?.output as NormalizedDoc | undefined
      const segments =
        (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments ?? []
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      const castOut = findUpstreamByStage(ctx.steps, step.id, 'cast')?.output as CastStageOutput | undefined
      if (!doc) throw new Error('缺少上游的规范化结果')
      if (!sceneSetup) throw new Error('缺少上游的场景构建结果')

      const { output, result } = await runSituationStage(ctx.client, {
        doc,
        segments,
        sceneSetup,
        cards: castOut?.characters ?? [],
        pcName: ctx.project.pcName,
        storyTitle: ctx.project.storyTitle,
        idle: ctx.round.idle,
        rating: ctx.round.rating ?? 'general',
        direct: Boolean(ctx.round.direct),
        previousRecap: buildRecap(ctx),
        previous: previousSituation(ctx),
        ...r18StreakOf(ctx),
        recentScores: recentSexScores(ctx),
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'perceive': {
      const castOut = findUpstreamByStage(ctx.steps, step.id, 'cast')?.output as CastStageOutput | undefined
      const segments =
        (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments ?? []
      const exposure = findUpstreamByStage(ctx.steps, step.id, 'exposure')?.output as PcExposure | undefined
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      const cards = castOut?.characters ?? []

      // 位置与注意力来自场景构建 —— 判断「谁背对着谁」需要它
      const positions: Record<string, string> = {}
      for (const item of sceneSetup?.present ?? []) {
        const matched = cards.find((candidate) => candidate.name === item.name)
        if (matched) positions[matched.id] = [item.role, item.brief].filter(Boolean).join('，') || '（未说明）'
      }

      const situation = findUpstreamByStage(ctx.steps, step.id, 'situation')?.output as SituationState | undefined

      // 交棒轮的那句占位原文是给用户和导演看的，不是这一轮发生的事 ——
      // 角色只该看得见「他没有动」这个事实，看不见「他交棒了」这件事。
      const perceivableSegments = ctx.round.idle ? [] : segments

      const { output, result } = await runPerceiveStage(ctx.client, {
        cards,
        segments: perceivableSegments,
        exposure,
        sceneSetup,
        pcName: ctx.project.pcName,
        rating: ctx.round.rating ?? 'general',
        situation,
        positions,
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'context': {
      const characterId = String(step.meta?.characterId ?? '')
      const castOut = findUpstreamByStage(ctx.steps, step.id, 'cast')?.output as CastStageOutput | undefined
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      const segments = (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments
      const card = castOut?.characters.find((item) => item.id === characterId)
      if (!castOut) throw new Error('缺少上游的阵容解析结果')
      if (!sceneSetup) throw new Error('缺少上游的场景构建结果')
      if (!card) throw new Error(`阵容里找不到角色 ${characterId}`)

      // 他亲身记得的以前轮次（跨轮记忆从这里进来，同样限定在当前对话内）
      const memories = recallFor(getMemories(ctx.steps, { roundIds: sessionRoundIds(ctx) }), card.id)
      // 从「你」的内心外化出来的可见表现：只给现象，绝不带你的真实想法
      const exposure = findUpstreamByStage(ctx.steps, step.id, 'exposure')?.output as PcExposure | undefined
      const pcCues: ObservedCue[] = (exposure?.cues ?? []).map((cue) => ({
        visible: cue.visible,
        readability: cue.readability,
        channel: cue.channel,
        fromIndex: cue.fromIndex,
        leakage: cue.leakage,
      }))
      // 他这一轮实际接收到的那一份 —— 由信息分发层筛过，原文由编号取回
      const perception = findUpstreamByStage(ctx.steps, step.id, 'perceive')?.output as PerceptionOutcome | undefined
      const reception = perception?.entries.find((entry) => entry.characterId === card.id)

      const situation = findUpstreamByStage(ctx.steps, step.id, 'situation')?.output as SituationState | undefined

      // 这一轮在他之前行动的人已经说了什么做了什么 —— 他就在旁边，听得见
      const earlierBeats: PerceivedEvent[] = []
      for (const step_ of upstreamStepsByStage(ctx.steps, step.id, 'roleplay')) {
        const output = step_.output as RoleplayOutput | undefined
        const speaker = String(step_.meta?.characterName ?? output?.name ?? '有人')
        for (const beat of output?.beats ?? []) {
          const text = beat.text.trim()
          if (!text) continue
          earlierBeats.push({ kind: beat.kind, from: speaker, text, self: speaker === card.name })
        }
      }

      const output = buildContextBundle({
        card,
        roundIndex: ctx.round.index,
        earlierBeats,
        segments: ctx.round.idle ? [] : segments ?? [],
        cards: castOut.characters,
        pcName: ctx.project.pcName,
        sceneSetup,
        recap: buildRecap(ctx),
        situation: situation,
        direction: situation?.directions?.find((item) => item.who === card.name),
        history: collectHistory({
          rounds: ctx.rounds ?? [],
          steps: ctx.steps,
          card,
          pcName: ctx.project.pcName,
          sessionId: ctx.round.sessionId,
          currentRoundId: ctx.round.id,
        }),
        memories,
        pcCues,
        candidates: perception?.candidates ?? [],
        reception,
      })
      return done(step, output, { cost: elapsed(startedAt) })
    }

    case 'roleplay': {
      const bundle = findUpstreamByStage(ctx.steps, step.id, 'context')?.output as ContextBundle | undefined
      if (!bundle) throw new Error('缺少上游的上下文包')

      const { output, result } = await runRoleplayStage(ctx.client, {
        bundle,
        project: ctx.project,
        rating: ctx.round.rating ?? 'general',
        direct: Boolean(ctx.round.direct),
      })
      return done(step, output, { model: result?.model, cost: costOf(result, startedAt) })
    }

    case 'compose': {
      const segments = (findUpstreamByStage(ctx.steps, step.id, 'segment')?.output as SegmentStageOutput | undefined)?.segments
      const cards = (findUpstreamByStage(ctx.steps, step.id, 'cast')?.output as CastStageOutput | undefined)?.characters ?? []
      const sceneSetup = findUpstreamByStage(ctx.steps, step.id, 'scene')?.output as SceneSetup | undefined
      if (!sceneSetup) throw new Error('缺少上游的场景构建结果')

      const roleplays = upstreamStepsByStage(ctx.steps, step.id, 'roleplay')
        .map((item) => item.output as RoleplayOutput)
        .filter(Boolean)
      const exposure = findUpstreamByStage(ctx.steps, step.id, 'exposure')?.output as PcExposure | undefined
      const situation = findUpstreamByStage(ctx.steps, step.id, 'situation')?.output as SituationState | undefined

      const output = composeScene({
        sceneSetup,
        segments: segments ?? [],
        cards,
        roleplays,
        pcName: ctx.project.pcName,
        exposure,
        situation,
      })
      return done(step, output, { cost: elapsed(startedAt) })
    }

    case 'commit': {
      const roleplaySteps = upstreamStepsByStage(ctx.steps, step.id, 'roleplay')
      const inputs: MemoryBuildInput[] = []

      for (const roleplayStep of roleplaySteps) {
        const roleplay = roleplayStep.output as RoleplayOutput | undefined
        const bundle = findUpstreamByStage(ctx.steps, roleplayStep.id, 'context')?.output as ContextBundle | undefined
        if (!roleplay || !bundle) continue
        inputs.push({ round: ctx.round, bundle, roleplay, where: describeWhere(bundle) })
      }

      // 记忆是「他自己经历的版本」，不是全知剧本
      return done(step, { entries: buildRoundMemories(inputs) }, { cost: elapsed(startedAt) })
    }

    default:
      throw new Error(`阶段「${step.stage}」还没有实现`)
  }
}

/**
 * 按依赖关系分层并发执行。
 * 同一个批次里互不依赖的步骤（例如给不同角色组上下文、不同角色的反应）会真并发跑。
 */
export async function runSteps(
  ctx: PipelineContext,
  orderedIds: string[],
): Promise<{ steps: StepIndex; ledger: LedgerIndex }> {
  let steps: StepIndex = { ...ctx.steps }
  const ledger: LedgerIndex = ctx.ledger
  const remaining = new Set(orderedIds)
  const concurrency = Math.max(1, Math.floor(ctx.client.settings.maxConcurrency) || 4)
  const pool = createPool(concurrency)

  const emit = () => ctx.onUpdate?.(steps, ledger)

  while (remaining.size) {
    const ready = [...remaining].filter((id) => (steps[id]?.deps ?? []).every((dep) => !remaining.has(dep)))
    if (!ready.length) {
      for (const id of remaining) {
        const step = steps[id]
        if (step) steps = { ...steps, [id]: { ...step, status: 'error', error: '依赖无法满足（可能存在循环依赖）' } }
      }
      break
    }
    for (const id of ready) remaining.delete(id)

    // 已锁定且已完成：直接复用，不重算
    const toExecute = ready.filter((id) => !(steps[id]?.lockedByUser && steps[id]?.status === 'done'))

    for (const id of toExecute) {
      const step = steps[id]
      if (step) steps = { ...steps, [id]: { ...step, status: 'running', updatedAt: nowIso() } }
    }
    emit()

    await Promise.all(
      toExecute.map((id) =>
        pool(async () => {
          const step = steps[id]
          if (!step) return
          try {
            const next = await executeStep({ ...ctx, steps, ledger }, step)
            steps = { ...steps, [id]: next }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const current = steps[id]
            if (current) steps = { ...steps, [id]: { ...current, status: 'error', error: message, updatedAt: nowIso() } }
          } finally {
            emit()
          }
        }),
      ),
    )
  }

  return { steps, ledger }
}

/* ------------------------------ 整轮执行 ------------------------------ */

export interface FullRoundResult {
  steps: StepIndex
  ledger: LedgerIndex
  rootStepIds: string[]
  composeStepId: string | null
  castStepId: string | null
  sceneStepId: string | null
  error?: string
}

/**
 * 一键跑完整轮：
 *   S0 规范化 → S1 拆解 → S2 场景构建 → S3 阵容 → 每角色各自的上下文与反应 → S7 编排。
 * 每个角色一条独立分支，重跑时可以只重算受影响的那条。
 */
export async function runFullRound(ctx: PipelineContext): Promise<FullRoundResult> {
  let steps: StepIndex = { ...ctx.steps }
  const ledger = ctx.ledger
  const emit = () => ctx.onUpdate?.(steps, ledger)

  // S0 + S1
  const normalizeStep = createStep<NormalizedDoc>({
    roundId: ctx.round.id,
    stage: 'normalize',
    label: '规范化',
    inputSnapshot: { userInput: ctx.round.userInput },
  })
  const segmentStep = createStep<SegmentStageOutput>({
    roundId: ctx.round.id,
    stage: 'segment',
    label: '拆解',
    deps: [normalizeStep.id],
  })
  steps = { ...steps, [normalizeStep.id]: normalizeStep, [segmentStep.id]: segmentStep }

  let result = await runSteps({ ...ctx, steps, ledger }, [normalizeStep.id, segmentStep.id])
  steps = result.steps
  emit()

  const segmentOutput = steps[segmentStep.id]?.output as SegmentStageOutput | undefined
  if (!segmentOutput?.segments?.length) {
    return {
      steps,
      ledger,
      rootStepIds: [normalizeStep.id, segmentStep.id],
      composeStepId: null,
      castStepId: null,
      sceneStepId: null,
      error: '拆解没有产出任何片段，无法继续',
    }
  }

  // S2 场景构建：把概要展开成可以开演的场面
  const sceneStep = createStep<SceneSetup>({
    roundId: ctx.round.id,
    stage: 'scene',
    label: '场景构建',
    deps: [segmentStep.id],
  })
  steps = { ...steps, [sceneStep.id]: sceneStep }
  result = await runSteps({ ...ctx, steps, ledger }, [sceneStep.id])
  steps = result.steps
  emit()

  // S2b 你的外化：把你的内心变成别人看得见的表现
  const exposureStep = createStep<PcExposure>({
    roundId: ctx.round.id,
    stage: 'exposure',
    label: '你的外化',
    deps: [segmentStep.id, sceneStep.id],
  })
  steps = { ...steps, [exposureStep.id]: exposureStep }
  result = await runSteps({ ...ctx, steps, ledger }, [exposureStep.id])
  steps = result.steps
  emit()

  // S3 阵容
  const castStep = createStep<CastStageOutput>({
    roundId: ctx.round.id,
    stage: 'cast',
    label: '阵容解析',
    deps: [segmentStep.id, sceneStep.id],
  })
  steps = { ...steps, [castStep.id]: castStep }
  result = await runSteps({ ...ctx, steps, ledger }, [castStep.id])
  steps = result.steps
  emit()

  const castOutput = steps[castStep.id]?.output as CastStageOutput | undefined
  const castActors = castOutput?.characters ?? []

  // S3c 局面推进：一次调用，让「世界」自己往前走一步，并由它决定这一轮谁先动。
  // 它排在信息分发之前，所以这一轮新发生的事也会被分发出去。
  const situationStep = createStep<SituationState>({
    roundId: ctx.round.id,
    stage: 'situation',
    label: '局面推进',
    deps: [castStep.id, segmentStep.id, sceneStep.id],
  })
  steps = { ...steps, [situationStep.id]: situationStep }
  result = await runSteps({ ...ctx, steps, ledger }, [situationStep.id])
  steps = result.steps
  emit()

  // 出场顺序由「局面」决定；它没给或者给漏了，就退回阵容顺序补齐
  const situationOutput = steps[situationStep.id]?.output as SituationState | undefined
  const actors = orderActors(castActors, situationOutput?.order ?? [])

  // 信息分发：一次调用，把这一轮转化成「每个人各自接收到的版本」
  const perceiveStep = createStep<PerceptionOutcome>({
    roundId: ctx.round.id,
    stage: 'perceive',
    label: '信息分发',
    deps: [castStep.id, segmentStep.id, exposureStep.id, situationStep.id],
  })

  // 角色按「局面」定下的顺序**逐个**演绎：后开口的人看得到先开口的人已经说了什么。
  // 这不是性能取舍 —— 时间顺序上 A 先说了话，B 就在旁边，他当然听得见。
  // 依赖链（context_i 依赖 roleplay_0..i-1）会让调度器自然地串起来。
  const contextSteps: Step[] = []
  const roleplaySteps: Step[] = []
  for (const card of actors) {
    const contextStep = createStep<ContextBundle>({
      roundId: ctx.round.id,
      stage: 'context',
      label: `给「${card.name}」的上下文`,
      deps: [castStep.id, exposureStep.id, perceiveStep.id, ...roleplaySteps.map((step) => step.id)],
      meta: { characterId: card.id, characterName: card.name },
    })
    const roleplayStep = createStep<RoleplayOutput>({
      roundId: ctx.round.id,
      stage: 'roleplay',
      label: `「${card.name}」的反应`,
      deps: [contextStep.id],
      meta: { characterId: card.id, characterName: card.name },
    })
    contextSteps.push(contextStep)
    roleplaySteps.push(roleplayStep)
  }

  for (const step of [perceiveStep, ...contextSteps, ...roleplaySteps]) {
    steps = { ...steps, [step.id]: step }
  }

  if (roleplaySteps.length) {
    result = await runSteps(
      { ...ctx, steps, ledger },
      [perceiveStep.id, ...contextSteps.map((step) => step.id), ...roleplaySteps.map((step) => step.id)],
    )
    steps = result.steps
    emit()
  }

  // S7 编排
  const composeStep = createStep({
    roundId: ctx.round.id,
    stage: 'compose',
    label: '编排',
    deps: [
      segmentStep.id,
      sceneStep.id,
      exposureStep.id,
      castStep.id,
      situationStep.id,
      ...roleplaySteps.map((step) => step.id),
    ],
  })
  steps = { ...steps, [composeStep.id]: composeStep }
  result = await runSteps({ ...ctx, steps, ledger }, [composeStep.id])
  steps = result.steps
  emit()

  // S8 记忆回写：把这一轮变成每个参与角色各自的一段记忆
  // 依赖编排，这样从「编排」重跑时也会连带重算记忆
  const commitStep = createStep({
    roundId: ctx.round.id,
    stage: 'commit',
    label: '记忆回写',
    deps: [composeStep.id, ...roleplaySteps.map((step) => step.id)],
  })
  steps = { ...steps, [commitStep.id]: commitStep }
  result = await runSteps({ ...ctx, steps, ledger }, [commitStep.id])
  steps = result.steps
  emit()

  return {
    steps,
    ledger,
    rootStepIds: [normalizeStep.id, composeStep.id],
    composeStepId: composeStep.id,
    castStepId: castStep.id,
    sceneStepId: sceneStep.id,
  }
}

/* ------------------------------ 只跑拆解 ------------------------------ */

export interface SegmentationPreviewResult {
  steps: StepIndex
  ledger: LedgerIndex
  normalizeStepId: string
  segmentStepId: string
}

/** 只跑 S0 + S1，用于单独查看拆解 */
export async function runSegmentationPreview(ctx: PipelineContext): Promise<SegmentationPreviewResult> {
  const normalizeStep = createStep<NormalizedDoc>({
    roundId: ctx.round.id,
    stage: 'normalize',
    label: '规范化',
    inputSnapshot: { userInput: ctx.round.userInput },
  })
  const segmentStep = createStep<SegmentStageOutput>({
    roundId: ctx.round.id,
    stage: 'segment',
    label: '拆解',
    deps: [normalizeStep.id],
  })

  const steps: StepIndex = {
    ...ctx.steps,
    [normalizeStep.id]: normalizeStep,
    [segmentStep.id]: segmentStep,
  }

  const result = await runSteps({ ...ctx, steps }, [normalizeStep.id, segmentStep.id])

  return { ...result, normalizeStepId: normalizeStep.id, segmentStepId: segmentStep.id }
}

/* ------------------------------ 重跑 ------------------------------ */

export interface RerunResult {
  steps: StepIndex
  ledger: LedgerIndex
  toRun: string[]
  reused: string[]
}

/**
 * 从某一步重跑：
 * 1. 计算受影响的下游；
 * 2. 按账本撤销这些步骤产生的副作用；
 * 3. 只重算受影响的步骤，未受影响的分支直接复用。
 */
export async function rerunFrom(ctx: PipelineContext, rootStepId: string): Promise<RerunResult> {
  const plan = planRerun(ctx.steps, ctx.ledger, rootStepId)
  const { kept } = revokeBySteps(ctx.ledger, plan.toRun)

  let steps: StepIndex = { ...ctx.steps }
  for (const id of plan.toRun) {
    const step = steps[id]
    if (!step) continue
    steps[id] = { ...step, status: 'pending', error: undefined, updatedAt: nowIso() }
  }

  const result = await runSteps({ ...ctx, steps, ledger: kept }, plan.toRun)

  return { ...result, toRun: plan.toRun, reused: plan.reused }
}
