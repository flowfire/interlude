import { describe, expect, it } from 'vitest'
import { isRoundStalled } from '@/utils/r18'

/**
 * 「没涨 = 不合格」的判定。
 *
 * 这条规则有个必须排除的例外：**第一轮判不出来** —— 那时上一轮的分默认是 0，
 * 而这一轮也完全可能合理地是 0（场面刚开场），拿 0 跟 0 比就成了冤案。
 */

const r18 = { rating: 'r18' as const, direct: true }

describe('快速模式：没涨算不合格', () => {
  it('第一轮永远不判不合格 —— 基准是 0，怎么算都"没涨"', () => {
    expect(isRoundStalled(r18, { sexScore: 0, prevSexScore: 0, r18Streak: 1 })).toBe(false)
    // 哪怕第一轮就是 0 分（场面刚开场），也不能冤它
    expect(isRoundStalled(r18, { sexScore: 0, prevSexScore: 0, r18Streak: 1 })).toBe(false)
  })

  it('从第二轮起，没涨就是不合格', () => {
    expect(isRoundStalled(r18, { sexScore: 0, prevSexScore: 0, r18Streak: 2 })).toBe(true)
    expect(isRoundStalled(r18, { sexScore: 20, prevSexScore: 50, r18Streak: 3 })).toBe(true)
    expect(isRoundStalled(r18, { sexScore: 50, prevSexScore: 50, r18Streak: 4 })).toBe(true)
  })

  it('涨了就合格', () => {
    expect(isRoundStalled(r18, { sexScore: 20, prevSexScore: 0, r18Streak: 2 })).toBe(false)
    expect(isRoundStalled(r18, { sexScore: 110, prevSexScore: 100, r18Streak: 3 })).toBe(false)
  })

  it('没勾快速模式就不判 —— 普通成人向是「允许」，不要求推进', () => {
    expect(
      isRoundStalled({ rating: 'r18', direct: false }, { sexScore: 0, prevSexScore: 0, r18Streak: 3 }),
    ).toBe(false)
    expect(
      isRoundStalled({ rating: 'general', direct: true }, { sexScore: 0, prevSexScore: 0, r18Streak: 3 }),
    ).toBe(false)
  })
})
