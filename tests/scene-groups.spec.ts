import { describe, expect, it } from 'vitest'
import { groupRoundsByScene } from '@/utils/sceneGroups'
import type { Round, Step } from '@/types/step'

/**
 * 按场景分组渲染。
 *
 * 最要紧的一条：**没有场景数据的轮次也不能丢** —— 它只是不挂场景卡，
 * 但那一轮的对话必须照常显示。（早先漏掉这一类，会整段消失。）
 */

const round = (id: string, index: number) =>
  ({ id, index, sessionId: 's1', userInput: '', stepIds: [], rootStepIds: [], status: 'done', createdAt: '', updatedAt: '' }) as unknown as Round

const sceneStep = (roundId: string, unchanged: boolean) =>
  ({ id: `sc-${roundId}`, roundId, stage: 'scene', status: 'done', output: { unchanged } }) as unknown as Step

describe('按场景分组', () => {
  it('场景沿用的轮次并进上一组，不新开卡', () => {
    const groups = groupRoundsByScene(
      [round('r1', 1), round('r2', 2), round('r3', 3)],
      { a: sceneStep('r1', false), b: sceneStep('r2', true), c: sceneStep('r3', false) },
    )
    expect(groups.map((g) => [g.sceneRoundId, g.rounds.length])).toEqual([
      ['r1', 2],
      ['r3', 1],
    ])
  })

  it('没有场景数据的轮次照样在，只是 sceneRoundId 为空', () => {
    const groups = groupRoundsByScene(
      [round('r1', 1), round('r2', 2)],
      { a: sceneStep('r1', false) }, // r2 还没有 / 失败了 / stale
    )
    expect(groups).toHaveLength(2)
    expect(groups[1].sceneRoundId).toBe('')
    expect(groups[1].rounds.map((r) => r.id)).toEqual(['r2'])
  })

  it('场景步骤是 stale 也能用 —— 内容仍然有效', () => {
    const stale = { ...sceneStep('r1', false), status: 'stale' } as unknown as Step
    const groups = groupRoundsByScene([round('r1', 1)], { a: stale })
    expect(groups[0].sceneRoundId).toBe('r1')
  })

  it('一轮都没有时返回空数组，不炸', () => {
    expect(groupRoundsByScene([], {})).toEqual([])
  })
})
