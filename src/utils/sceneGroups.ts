import type { SceneSetup } from '@/types/scene'
import type { Round, Step } from '@/types/step'

/**
 * 从步骤表里取某一轮的场景产物。
 *
 * **这是唯一的判据**：只要那一格有产物就用，不看 status —— 上游被改过之后
 * 它可能已经是 stale，但内容仍然有效。
 *
 * 这个条件曾经在两处各写了一遍（分组时一处、渲染场景卡时一处），改了一处
 * 忘了另一处，结果就是"这一轮明明有场景，却没有场景卡"。
 */
export function findSceneSetup(
  steps: Record<string, Step>,
  roundId: string,
): SceneSetup | undefined {
  const step = Object.values(steps).find(
    (item) => item.roundId === roundId && item.stage === 'scene' && item.output,
  )
  return (step?.output as SceneSetup | undefined) ?? undefined
}

export interface SceneGroup {
  /** 这个场景属于哪一轮；为空表示这一组没有场景数据（照样要渲染） */
  sceneRoundId: string
  rounds: Round[]
}

/**
 * 按**场景**把轮次分组 —— UI 的单位是场景，不是轮次。
 *
 * 轮次只是内容上的分段；同一个人待在同一个地方的那几轮，在界面上属于同一个
 * 场景，共用一张卡。沿用了上一个场景的轮次并进上一组，不新开卡。
 *
 * **没有场景数据的轮次也必须留在这里**（`sceneRoundId` 留空）。
 * 这一类包括：刚发出去还没跑完的、场景那一步失败了的、上游被改过之后
 * 场景变成 stale 的。早先这里是 `if (!setup) continue`，
 * 结果那些轮次会整段从界面上消失 —— 用户点一下「解锁」触发重渲染就看到了。
 */
export function groupRoundsByScene(rounds: Round[], steps: Record<string, Step>): SceneGroup[] {
  const groups: SceneGroup[] = []
  for (const round of rounds) {
    const setup = findSceneSetup(steps, round.id)

    const startsScene = !setup || !setup.unchanged
    if (startsScene || !groups.length) {
      groups.push({ sceneRoundId: setup ? round.id : '', rounds: [round] })
    } else {
      groups[groups.length - 1].rounds.push(round)
    }
  }
  return groups
}
