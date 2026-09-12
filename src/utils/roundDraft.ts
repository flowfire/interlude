import type { ContentRating, Round } from '@/types/step'

export interface RoundDraft {
  userInput: string
  rating: ContentRating
}

export function roundDraftOf(round: Round): RoundDraft {
  return { userInput: round.userInput, rating: round.rating ?? 'general' }
}

/**
 * 只要「内容」或「分级」任一项变了，就算改过。
 *
 * 单独把分级拎出来判断是有意的：内容一个字没动、只把 R18 从关切到开，
 * 也是一次实质修改，应该允许重新生成（否则你没法把已经演过的一轮改成成人向）。
 */
export function isRoundDraftDirty(round: Round, draft: RoundDraft): boolean {
  return (
    draft.userInput.trim() !== round.userInput.trim() ||
    draft.rating !== (round.rating ?? 'general')
  )
}
