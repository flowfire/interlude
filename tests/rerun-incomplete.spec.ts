import { describe, expect, it } from 'vitest'
import { roundIsComplete } from '@/ui/usePipelineActions'
import type { Step } from '@/types/step'

/**
 * 一轮跑到一半失败后，单步重跑必须能自愈。
 *
 * `rerunFrom` 只重跑**已存在的**下游（不存在的会被 `if (!step) continue` 跳过），
 * 所以"从「局面推进」重跑"在缺步骤的轮次上永远补不齐 —— 用户会反复点重跑、
 * 结果毫无变化。`rerunStep` 现在先看这一轮全不全，不全就直接重跑整轮。
 */

const step = (roundId: string, stage: string, index: number) =>
  ({ id: `${stage}${index}`, roundId, stage, label: stage, status: 'done', deps: [] }) as unknown as Step

describe('一轮是否跑全', () => {
  it('走到「编排」才算全', () => {
    const steps = {
      a: step('r1', 'normalize', 1),
      b: step('r1', 'situation', 2),
      c: step('r1', 'compose', 3),
    }
    expect(roundIsComplete(steps, 'r1')).toBe(true)
  })

  it('停在「局面推进」就是没跑全 —— 这时必须重跑整轮', () => {
    const steps = {
      a: step('r1', 'normalize', 1),
      b: step('r1', 'segment', 2),
      c: step('r1', 'situation', 3),
    }
    expect(roundIsComplete(steps, 'r1')).toBe(false)
  })

  it('看的是指定那一轮，不会被别的轮次带偏', () => {
    const steps = { a: step('r1', 'situation', 1), b: step('r2', 'compose', 2) }
    expect(roundIsComplete(steps, 'r1')).toBe(false)
    expect(roundIsComplete(steps, 'r2')).toBe(true)
  })
})
