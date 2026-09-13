import type { ContentRating, Round } from '@/types/step'

export interface RoundDraft {
  userInput: string
  rating: ContentRating
  /** 成人向下的「快速入戏」 */
  direct: boolean
}

export function roundDraftOf(round: Round): RoundDraft {
  return {
    userInput: round.userInput,
    rating: round.rating ?? 'general',
    direct: Boolean(round.direct),
  }
}

/**
 * 只要「内容」「分级」「快速入戏」任一项变了，就算改过。
 *
 * 单独把这些拎出来判断是有意的：内容一个字没动、只把 R18 从关切到开，
 * 或者只是加勾了「快速入戏」，都是实质修改，应该允许重新生成。
 */
export function isRoundDraftDirty(round: Round, draft: RoundDraft): boolean {
  return (
    draft.userInput.trim() !== round.userInput.trim() ||
    draft.rating !== (round.rating ?? 'general') ||
    draft.direct !== Boolean(round.direct)
  )
}
