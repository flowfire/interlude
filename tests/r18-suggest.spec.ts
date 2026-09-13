import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 导演可以要求进入成人向。
 *
 * 规则只有一条：**那个勾此刻有没有勾上，决定这一轮能不能输出成人向内容。**
 * 导演每轮都可以提，用户每轮都可以取消，两边都不用记账。
 */
describe('导演要求进入成人向', () => {
  const canOpen = (suggested: boolean, allowR18: boolean, current: string) =>
    suggested && allowR18 && current !== 'r18'

  it('导演提了、总闸也开着 → 替他勾上', () => {
    expect(canOpen(true, true, 'general')).toBe(true)
  })

  it('设置里没允许成人向 → 这个能力根本不存在', () => {
    expect(canOpen(true, false, 'general')).toBe(false)
    // 总闸是产品默认关着的
    expect(DEFAULT_PROJECT_SETTINGS.allowR18 ?? false).toBe(false)
  })

  it('没提就不用管', () => {
    expect(canOpen(false, true, 'general')).toBe(false)
  })

  it('已经勾着就不用重复设 —— 用户手动取消之后，下一轮导演还能再提', () => {
    expect(canOpen(true, true, 'r18')).toBe(false)
    // 取消 → 回到普通 → 导演再提一次，仍然会勾上（不记"否决"）
    expect(canOpen(true, true, 'general')).toBe(true)
  })
})
