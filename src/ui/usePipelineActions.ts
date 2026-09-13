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
import type { SituationState } from '@/types/situation'
import type { PcExposure } from '@/types/exposure'
import type { ContentRating } from '@/types/step'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { Step } from '@/types/step'

/** 这一轮的步骤是不是跑全了 —— 判据是有没有走到「编排」 */
export function roundIsComplete(steps: Record<string, Step>, roundId: string): boolean {
  return Object.values(steps).some((item) => item.roundId === roundId && item.stage === 'compose')
}

function fail(error: unknown, roundId?: string) {
  const message = error instanceof Error ? error.message : String(error)

  // 跑到一半炸掉时，"这一轮为什么只有前几步"是最难猜的。
  // 把**最后跑完的那一步**报出来 —— 病灶就在它后面那一步。
  let where = ''
  if (roundId) {
    const own = Object.values(useAppStore.getState().steps)
      .filter((step) => step.roundId === roundId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const last = own[own.length - 1]
    if (last) where = `\n\n（这一轮停在「${last.label}」之后 —— 问题就出在下一步。）`
  }

  useAppStore.getState().setError(message + where)
}

function describeRunning(steps: Record<string, Step>): string {
  const running = Object.values(steps).filter((step) => step.status === 'running')
  if (!running.length) return ''
  const names = running.map((step) => step.label)
  if (names.length <= 3) return `${names.join('、')} …`
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项 …`
}

/**
 * 这一轮里导演是不是宣告了成人向收尾。
 *
 * 客户端据此自动退出成人向模式 —— 免得用户勾了一次就一路挂着，
 * 陷进没完没了的 R18。关掉之后他随时可以再勾。
 */
function r18SuggestedIn(steps: Record<string, Step>): boolean {
  const step = Object.values(steps).find((item) => item.stage === 'situation')
  const state = step?.output as SituationState | undefined
  return Boolean(state?.suggestR18)
}

function r18EndedIn(steps: Record<string, Step>): boolean {
  const step = Object.values(steps).find((item) => item.stage === 'situation')
  const state = step?.output as SituationState | undefined
  return Boolean(state?.r18Ended)
}

/**
 * 开着「自动生图」时，这一轮出现了新场景就顺手画一张。
 *
 * 三条前提，缺一不做：开关开着、有 Key、这一轮**确实换了场景**
 * （沿用上一个的那种不画 —— 同一个地方画两张是浪费钱）。
 * 失败也不打扰：静默记在卡片上，用户可以手动重试。
 */
async function autoGenerateSceneImage(roundId: string): Promise<void> {
  const state = useAppStore.getState()
  if (!state.image.autoGenerate || !state.image.apiKey.trim()) return
  if (state.sceneImages[roundId]) return

  const sceneStep = Object.values(state.steps).find(
    (item) => item.roundId === roundId && item.stage === 'scene' && item.status === 'done',
  )
  const setup = sceneStep?.output as SceneSetup | undefined
  if (!setup || setup.unchanged || setup.fallbackReason) return

  state.setSceneImageBusy(roundId)
  try {
    const { generateSceneImage, sceneImagePrompt } = await import('@/engine/image/client')
    const url = await generateSceneImage({
      prompt: sceneImagePrompt({
        place: setup.place,
        atmosphere: setup.atmosphere,
        opening: setup.opening,
        situation: setup.situation,
      }),
      settings: useAppStore.getState().image,
    })
    useAppStore.getState().setSceneImage(roundId, url)
  } catch {
    // 自动生图失败不弹错 —— 手动点一下就能看到原因
  } finally {
    useAppStore.getState().setSceneImageBusy(null)
  }
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

    // 导演认为该进入成人向了 —— 替用户勾上。
    // 唯一的闸是设置里那个总开关：没允许的话这个能力根本不存在。
    // 用户可以随时取消，导演下一轮也可以再提出 —— 两边都不用记账，
    // 决定权始终是"那个勾此刻有没有勾上"。
    const state = useAppStore.getState()
    if (r18SuggestedIn(result.steps) && state.project.allowR18 && state.composer.rating !== 'r18') {
      state.setComposer({ rating: 'r18' })
    }

    void autoGenerateSceneImage(roundId)

    // 导演有权给成人向踩刹车：他宣告收尾了，就把勾选替用户关掉
    // （用户随时可以再勾回来，所以这里不需要问他）
    if (r18EndedIn(result.steps)) {
      const composer = useAppStore.getState().composer
      if (composer.rating === 'r18' || composer.direct) {
        useAppStore.getState().setComposer({ rating: 'general', direct: false })
      }
    }

    const composeStep = result.composeStepId ? result.steps[result.composeStepId] : undefined
    const castStep = result.castStepId ? result.steps[result.castStepId] : undefined
    const scene = composeStep?.output as ComposedScene | undefined
    const cast = castStep?.output as CastStageOutput | undefined

    const sceneStep = result.sceneStepId ? result.steps[result.sceneStepId] : undefined
    const sceneSetup = sceneStep?.output as SceneSetup | undefined

    if (!scene?.reactions.length) {
      // 先分辨是"根本没有角色反应"还是"反应跑出来了但没进编排" ——
      // 这两种在界面上都是"没有角色说话"，但病根完全不同。
      const roleplaySteps = Object.values(result.steps).filter(
        (step) => step.roundId === roundId && step.stage === 'roleplay',
      )
      const beatsTotal = roleplaySteps.reduce((sum, step) => {
        const beats = (step.output as { beats?: unknown[] } | null)?.beats
        return sum + (Array.isArray(beats) ? beats.length : 0)
      }, 0)

      const presentNames = (sceneSetup?.present ?? []).map((item) => item.name)
      if (roleplaySteps.length) {
        useAppStore
          .getState()
          .setError(
            `生成了 ${roleplaySteps.length} 个角色反应（共 ${beatsTotal} 条演出），但它们没有进入编排结果。` +
              '\n\n这通常意味着「编排」那一步拿到的上游不对 —— 请把右栏「编排」的产物发我。',
          )
      } else if (!presentNames.length) {
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
    fail(error, roundId)
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

    // **上一次如果跑到一半就断了**（比如只走到「局面推进」，后面的
    // perceive / context / roleplay / compose 根本没被创建），
    // 那么"从某一步重跑"是永远补不齐的 —— `rerunFrom` 只重跑**已存在的**下游，
    // 不存在的会被 `if (!step) continue` 跳过。
    //
    // 这种情况直接重跑整轮，否则用户会反复点重跑、结果毫无变化。
    if (!roundIsComplete(ctx.steps, step.roundId)) {
      useAppStore.setState({
        busy: true,
        error: null,
        statusText: '这一轮上次没有跑完，正在重新跑完整的一轮…',
      })
      const result = await runFullRound(ctx)
      useAppStore.getState().mergeSteps(result.steps, result.ledger)
      if (result.error) useAppStore.getState().setError(result.error)
      return
    }

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
  // 重演本身就会换掉这一轮的内容，所以哪怕没有后续轮次可丢，也要留一个撤销点
  store.saveUndo(later.length ? `重演这一轮，丢弃 ${later.length} 轮` : '重演这一轮')
  store.truncateAfterRound(roundId)

  try {
    const ctx = makeContext(roundId)
    const firstStep = Object.values(ctx.steps)
      .filter((step) => step.roundId === roundId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

    // 没有步骤、或者这一轮**上次没跑完**（缺 perceive 之后那几步）——
    // 这两种都得跑完整的一轮。`rerunFrom` 只会重跑已存在的下游，
    // 不存在的会被跳过，所以它补不齐断掉的轮次：用户反复重演也没用。
    if (!firstStep || !roundIsComplete(ctx.steps, roundId)) {
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
  direct?: boolean,
): Promise<void> {
  const store = useAppStore.getState()
  if (store.busy) return

  const text = newInput.trim()
  if (!text) return

  const round = store.rounds.find((item) => item.id === roundId)
  if (!round) return

  const nextRating = rating ?? round.rating ?? 'general'
  const ratingChanged = nextRating !== (round.rating ?? 'general')
  const nextDirect = nextRating === 'r18' ? Boolean(direct ?? round.direct) : false
  const directChanged = nextDirect !== Boolean(round.direct)

  const later = store.rounds.filter((item) => item.sessionId === round.sessionId && item.index > round.index)
  store.saveUndo(later.length ? `改这一轮，丢弃 ${later.length} 轮` : '改这一轮')

  // 1. 丢弃这一轮之后的轮次
  store.truncateAfterRound(roundId)
  // 2. 换上新写的原文
  useAppStore.getState().updateRoundInput(roundId, text)
  // 3. 分级也一起落下（只改了分级同样要重跑）
  if (ratingChanged) useAppStore.getState().setRoundRating(roundId, nextRating)
  if (directChanged) useAppStore.getState().setRoundDirect(roundId, nextDirect)
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

/** 这一轮「世界」自己往前走的那一步 */
export function getSituationOfRound(roundId: string): { stepId: string; state: SituationState } | null {
  const steps = useAppStore.getState().steps
  const step = Object.values(steps).find((item) => item.roundId === roundId && item.stage === 'situation')
  const state = step?.output as SituationState | undefined
  if (!step || !state) return null
  return { stepId: step.id, state }
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
