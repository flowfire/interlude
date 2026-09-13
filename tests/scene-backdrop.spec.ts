import { describe, expect, it } from 'vitest'
import { pickBackdrop } from '@/utils/sceneBackdrop'

/**
 * 界面背景用哪张图。三条规则里后两条最容易被"顺手优化掉"，
 * 所以单独立了测试。
 */

const order = ['r1', 'r2', 'r3']
const images = { r1: 'first.png', r2: 'second.png', r3: 'third.png' }

describe('界面背景取哪张图', () => {
  it('有卡片吸顶时，用那一轮的图', () => {
    expect(pickBackdrop({ stuckRoundId: 'r2', firstRoundId: 'r1', roundOrder: order, sceneImages: images })).toBe(
      'second.png',
    )
    expect(pickBackdrop({ stuckRoundId: 'r3', firstRoundId: 'r1', roundOrder: order, sceneImages: images })).toBe(
      'third.png',
    )
  })

  it('一张都没吸顶时，用第一张卡片的图（此时停在第一段剧情之前）', () => {
    expect(pickBackdrop({ stuckRoundId: null, firstRoundId: 'r1', roundOrder: order, sceneImages: images })).toBe(
      'first.png',
    )
  })

  it('场景沿用的轮次没图时，往前找最近的那张 —— 不能空掉', () => {
    // r2 沿用了场景，它自己没有图，但场景还是 r1 那个
    expect(
      pickBackdrop({
        stuckRoundId: 'r2',
        firstRoundId: 'r1',
        roundOrder: order,
        sceneImages: { r1: 'first.png' },
      }),
    ).toBe('first.png')
    // 一路往前都没有图，那才空
    expect(
      pickBackdrop({ stuckRoundId: 'r3', firstRoundId: 'r1', roundOrder: order, sceneImages: {} }),
    ).toBe('')
  })

  it('第一张没有图就是没有背景 —— 不许回退去找第一张有图的', () => {
    expect(
      pickBackdrop({
        stuckRoundId: null,
        firstRoundId: 'r1',
        roundOrder: order,
        sceneImages: { r2: 'second.png' },
      }),
    ).toBe('')
  })

  it('一轮都没有时返回空，不炸', () => {
    expect(
      pickBackdrop({ stuckRoundId: null, firstRoundId: '', roundOrder: [], sceneImages: images }),
    ).toBe('')
    expect(
      pickBackdrop({ stuckRoundId: null, firstRoundId: '', roundOrder: [], sceneImages: {} }),
    ).toBe('')
  })
})
