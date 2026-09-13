import type { SituationState } from '@/types/situation'
import type { Round } from '@/types/step'

/**
 * 这一轮算不算「不合格」。
 *
 * 规则来自用户：**快速模式下，性评分没比上一轮高就是不合格。**
 * 但有一个例外必须排除 —— **第一轮判不出来**：那时上一轮的分默认就是 0，
 * 而这一轮也完全可能合理地是 0（场面刚开场，什么都还没发生），
 * 拿 0 跟 0 比就变成"怎么都合格不了"的误判。
 *
 * 所以只有在这两条都满足时才判：这一轮确实有可比的上一轮（r18Streak > 1），
 * 而且这一轮勾着快速模式。
 */
export function isRoundStalled(
  round: Pick<Round, 'rating' | 'direct'>,
  state: Pick<SituationState, 'sexScore' | 'prevSexScore' | 'r18Streak'>,
): boolean {
  if (round.rating !== 'r18' || !round.direct) return false
  if (state.r18Streak <= 1) return false
  return state.sexScore <= state.prevSexScore
}
