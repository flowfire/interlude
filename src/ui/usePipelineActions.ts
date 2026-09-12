import {
  findUpstreamByStage,
  rerunFrom,
  runFullRound,
  runSegmentationPreview,
  type PipelineContext,
} from '@/engine/pipeline'
import { explainLlmError, formatAdvice } from '@/engine/llm/errors'
import { llmClient } from '@/engine/llm/instance'
import { useAppStore } from '@/store/appStore'
import type { NormalizedDoc } from '@/engine/stages/s0-normalize'
import type { SegmentStageOutput } from '@/engine/stages/s1-segment'
import type { CastStageOutput } from '@/engine/stages/s3-cast'
import type { CharacterCard, ComposedScene, ContextBundle } from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { ContentRating } from '@/types/step'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { Step } from '@/types/step'

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  useAppStore.getState().setError(message)
}

function describeRunning(steps: Record<string, Step>): string {
  const running = Object.values(steps).filter((step) => step.status === 'running')
  if (!running.length) return ''
  const names = running.map((step) => step.label)
  if (names.length <= 3) return `${names.join('、')} …`
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项 …`
}

function makeContext(roundId: string): PipelineContext {
  const state = useAppStore.getState()
  const round = state.rounds.find((item) => item.id === roundId)
  if (!round) throw new Error('找不到这一轮对话')
  if (!round.userInput.trim()) throw new Error('先在输入框里写点东西')

  return {
    client: llmClient,
    project: state.project,
    round,
    rounds: state.rounds,
    steps: state.steps,
    ledger: state.ledger,
    onUpdate: (steps, ledger) => {
      const store = useAppStore.getState()
      store.mergeSteps(steps, ledger)
      useAppStore.setState({ statusText: describeRunning(steps) })
    },
  }
}

/** 一键跑完整轮：拆解 → 阵容 → 每个角色的上下文与反应 → 编排 */
export async function runRoundFor(roundId: string): Promise<void> {
  if (useAppStore.getState().busy) return

  try {
    const ctx = makeContext(roundId)
    useAppStore.setState({ busy: true, error: null, statusText: '正在拆解…' })

    const result = await runFullRound(ctx)
    useAppStore.getState().mergeSteps(result.steps, result.ledger)

    if (result.error) {
      useAppStore.getState().setError(result.error)
      return
    }

    const composeStep = result.composeStepId ? result.steps[result.composeStepId] : undefined
    const castStep = result.castStepId ? result.steps[result.castStepId] : undefined
    const scene = composeStep?.output as ComposedScene | undefined
    const cast = castStep?.output as CastStageOutput | undefined

    const sceneStep = result.sceneStepId ? result.steps[result.sceneStepId] : undefined
    const sceneSetup = sceneStep?.output as SceneSetup | undefined

    if (!scene?.reactions.length) {
      const presentNames = (sceneSetup?.present ?? []).map((item) => item.name)
      if (!presentNames.length) {
        // 场景构建降级是「在场 0 人」最常见的病根，直接点出来，别让人去猜
        const degraded = sceneSetup && sceneSetup.usedModel === false
        const diagnose = degraded
          ? `\n\n⚠️ 但场景构建这次没有成功调用模型，退回成了规则推断。\n${formatAdvice(explainLlmError(sceneSetup?.fallbackReason))}`
          : '\n\n（素材里可以写得更明确些，比如「我看到了金刚狼」。）'
        useAppStore.getState().setError(`这一轮场上只有你一个人，所以没有人需要反应。${diagnose}`)
      } else {
        const reason =
          cast?.usedModel === false
            ? `阵容解析降级了：${cast.fallbackReason ?? '未知'}`
            : '角色反应没生成出来，具体报错看右栏步骤历史。'
        useAppStore
          .getState()
          .setError(`这一轮识别到 ${presentNames.length} 个在场者（${presentNames.join('、')}），但没有人产生反应。${reason}`)
      }
    }

    // 给这条对话自动起个名字（只在这条对话还没被命名过时）
    if (sceneSetup) {
      const latest = useAppStore.getState()
      const ownRounds = latest.rounds.filter((item) => item.sessionId === ctx.round.sessionId)
      if (ownRounds.length <= 1) {
        const title = sceneSetup.place || sceneSetup.situation.slice(0, 14) || ctx.round.userInput.trim().slice(0, 14)
        if (title) latest.autoTitleSession(ctx.round.sessionId, title)
      }
    }
  } catch (error) {
    fail(error)
  } finally {
    useAppStore.setState({ busy: false, statusText: '' })
  }
}

/** 只跑拆解（历史功能，界面上不再单独暴露） */
export async function runPreviewForRound(roundId: string): Promise<void> {
  if (useAppStore.getState().busy) return

  try {
    const ctx = makeContext(roundId)
    useAppStore.setState({ busy: true, error: null, statusText: '正在拆解…' })

    const existingNormalize = Object.values(ctx.steps).find(
      (step) => step.roundId === roundId && step.stage === 'normalize',
    )
    const existingSegment = Object.values(ctx.steps).find(
      (step) => step.roundId === roundId && step.stage === 'segment',
    )

    if (existingNormalize && existingSegment) {
      await rerunFrom(ctx, existingNormalize.id)
    } else {
      await runSegmentationPreview(ctx)
    }
  } catch (error) {
    fail(error)
  } finally {
    useAppStore.setState({ busy: false, statusText: '' })
  }
}

/** 从某一步重跑 */
export async function rerunStep(stepId: string): Promise<void> {
  const store = useAppStore.getState()
  if (store.busy) return
  const step = store.steps[stepId]
  if (!step) return

  try {
    const ctx = makeContext(step.roundId)
    useAppStore.setState({ busy: true, error: null, statusText: `正在从「${step.label}」重跑…` })
    await rerunFrom(ctx, stepId)
  } catch (error) {
    fail(error)
  } finally {
    useAppStore.setState({ busy: false, statusText: '' })
  }
}

/**
 * 从某一轮重演：作废它之后的所有轮次，然后重新生成这一轮。
 *
 * 时间线是线性的 —— 在某一轮重新开始，后面的自然就不该存在了。
 * 所以界面上没有「删除轮次」这个操作。
 */
export async function replayFromRound(roundId: string): Promise<void> {
  const store = useAppStore.getState()
  if (store.busy) return

  const round = store.rounds.find((item) => item.id === roundId)
  if (!round) return

  const later = store.rounds.filter((item) => item.sessionId === round.sessionId && item.index > round.index)
  if (later.length) store.saveUndo(`重演这一轮，丢弃 ${later.length} 轮`)
  store.truncateAfterRound(roundId)

  try {
    const ctx = makeContext(roundId)
    const firstStep = Object.values(ctx.steps)
      .filter((step) => step.roundId === roundId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

    if (!firstStep) {
      await runRoundFor(roundId)
      return
    }

    useAppStore.setState({ busy: true, error: null, statusText: '正在重演这一轮…' })
    await rerunFrom(ctx, firstStep.id)
  } catch (error) {
    fail(error)
  } finally {
    useAppStore.setState({ busy: false, statusText: '' })
  }
}

/**
 * 改完原文后重新生成。
 *
 * 和「重演」的区别：输入变了，出场角色可能也变了 —— 所以要**清掉这一轮已有的步骤**，
 * 整棵步骤树（拆解 → 场景 → 阵容 → 各角色反应）从头重建；
 * 这一轮之后的轮次同样全部丢弃。
 */
export async function regenerateRoundFromInput(
  roundId: string,
  newInput: string,
  rating?: ContentRating,
): Promise<void> {
  const store = useAppStore.getState()
  if (store.busy) return

  const text = newInput.trim()
  if (!text) return

  const round = store.rounds.find((item) => item.id === roundId)
  if (!round) return

  const nextRating = rating ?? round.rating ?? 'general'
  const ratingChanged = nextRating !== (round.rating ?? 'general')

  const later = store.rounds.filter((item) => item.sessionId === round.sessionId && item.index > round.index)
  store.saveUndo(later.length ? `改这一轮，丢弃 ${later.length} 轮` : '改这一轮')

  // 1. 丢弃这一轮之后的轮次
  store.truncateAfterRound(roundId)
  // 2. 换上新写的原文
  useAppStore.getState().updateRoundInput(roundId, text)
  // 3. 分级也一起落下（只改了分级同样要重跑）
  if (ratingChanged) useAppStore.getState().setRoundRating(roundId, nextRating)
  // 4. 清掉这一轮的旧步骤（角色可能变了，结构要重建）
  useAppStore.getState().clearRoundSteps(roundId)
  // 5. 整轮重跑
  await runRoundFor(roundId)
}

/* --------------------------- 读取本轮产物 --------------------------- */
export interface RoundSegments {
  stepId: string
  segments: Segment[]
  doc?: NormalizedDoc
  usedModel: boolean
  fallbackReason?: string
}

export function getSegmentsOfRound(roundId: string): RoundSegments | null {
  const steps = useAppStore.getState().steps
  const segmentStep = Object.values(steps).find((step) => step.roundId === roundId && step.stage === 'segment')
  if (!segmentStep) return null

  const output = segmentStep.output as SegmentStageOutput | undefined
  if (!output) return null

  const docStep = findUpstreamByStage(steps, segmentStep.id, 'normalize')
  return {
    stepId: segmentStep.id,
    segments: output.segments ?? [],
    doc: docStep?.output as NormalizedDoc | undefined,
    usedModel: Boolean(output.usedModel),
    fallbackReason: output.fallbackReason,
  }
}

export function getComposeOfRound(roundId: string): { stepId: string; scene: ComposedScene } | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find((item) => item.roundId === roundId && item.stage === 'compose')
  const scene = step?.output as ComposedScene | undefined
  if (!step || !scene?.blocks) return null
  return { stepId: step.id, scene }
}

export function getCastOfRound(roundId: string): { stepId: string; cards: CharacterCard[]; usedModel: boolean } | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find((item) => item.roundId === roundId && item.stage === 'cast')
  const output = step?.output as CastStageOutput | undefined
  if (!step || !output) return null
  return { stepId: step.id, cards: output.characters ?? [], usedModel: Boolean(output.usedModel) }
}

/** 这一轮的场面设定（S2 的产物） */
export function getSceneOfRound(roundId: string): { stepId: string; setup: SceneSetup } | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find((item) => item.roundId === roundId && item.stage === 'scene')
  const setup = step?.output as SceneSetup | undefined
  if (!step || !setup) return null
  return { stepId: step.id, setup }
}

/** 这一轮你的内心外化结果（别人眼里的你） */
export function getExposureOfRound(roundId: string): { stepId: string; exposure: PcExposure } | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find((item) => item.roundId === roundId && item.stage === 'exposure')
  const exposure = step?.output as PcExposure | undefined
  if (!step || !exposure) return null
  return { stepId: step.id, exposure }
}

/** 找出「给某个角色」的那一步上下文，用于「它到底收到了什么」 */
export function getContextStepOf(roundId: string, characterId: string): Step<ContextBundle> | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find(
    (item) =>
      item.roundId === roundId && item.stage === 'context' && (item.meta?.characterId as string) === characterId,
  )
  return (step as Step<ContextBundle> | undefined) ?? null
}

export function getRoleplayStepOf(roundId: string, characterId: string): Step | null {
  const steps = useAppStore.getState().steps
  return (
    Object.values(steps).find(
      (item) =>
        item.roundId === roundId && item.stage === 'roleplay' && (item.meta?.characterId as string) === characterId,
    ) ?? null
  )
}
