import type { CastStageOutput } from '@/engine/stages/s3-cast'
import type { StepIndex } from '@/engine/graph/stepGraph'
import type { CharacterCard, KnownCastEntry } from '@/types/character'
import type { MemoryEntry } from '@/types/memory'

/**
 * 角色库与记忆都**从步骤图派生**，而不是单独存一份。
 *
 * 这样做的好处：回退、重跑、编辑某一步时，角色卡和记忆会跟着自动更新，
 * 不需要额外维护「撤销」逻辑，也不会出现"步骤回退了但记忆还留着"的不一致。
 *
 * 关键：两者都**按对话（session）隔离** —— 新开一条完全无关的故事线时，
 * 不会凭空认出上一场戏里的角色，也不会记着上一场戏发生过什么。
 */

export interface LibraryOptions {
  /** 只统计这些轮次。用于把角色库限制在当前这条对话内 */
  roundIds?: Set<string>
  /**
   * 排除某一轮。
   * 重跑本轮的阵容解析时，不能把自己上一次的产物当成「已有角色」，
   * 否则永远生成不出新的卡（人设改进就传不进去）。
   */
  excludeRoundId?: string
}

/**
 * 把本对话内历轮阵容解析产出的角色卡合并成一个角色库。
 * 按 updatedAt 排序，后更新的版本覆盖先前的 —— 这样重跑某轮的阵容解析后，
 * 新版卡片能盖过其他轮次里那份旧的副本。
 */
export function getCastLibrary(steps: StepIndex, options: LibraryOptions = {}): Record<string, CharacterCard> {
  const ordered = Object.values(steps)
    .filter((step) => step.stage === 'cast' && step.status === 'done')
    .filter((step) => !options.roundIds || options.roundIds.has(step.roundId))
    .filter((step) => step.roundId !== options.excludeRoundId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))

  const library: Record<string, CharacterCard> = {}
  for (const step of ordered) {
    const characters = (step.output as CastStageOutput | undefined)?.characters ?? []
    for (const card of characters) library[card.id] = card
  }
  return library
}

/** 汇总本对话内所有已完成的记忆回写 */
export function getMemories(
  steps: StepIndex,
  options: { roundIds?: Set<string> } = {},
): Record<string, MemoryEntry[]> {
  const out: Record<string, MemoryEntry[]> = {}

  for (const step of Object.values(steps)) {
    if (step.stage !== 'commit' || step.status !== 'done') continue
    if (options.roundIds && !options.roundIds.has(step.roundId)) continue
    const entries = (step.output as { entries?: MemoryEntry[] } | undefined)?.entries ?? []
    for (const entry of entries) {
      if (!out[entry.characterId]) out[entry.characterId] = []
      out[entry.characterId].push(entry)
    }
  }

  for (const list of Object.values(out)) {
    list.sort((a, b) => a.roundIndex - b.roundIndex || a.at.localeCompare(b.at))
  }

  return out
}

/** 取某个角色最近 N 轮的记忆（用于注入上下文） */
export function recallFor(
  memories: Record<string, MemoryEntry[]>,
  characterId: string,
  limit = 6,
): MemoryEntry[] {
  const own = memories[characterId] ?? []
  if (!own.length) return []
  return own.slice(Math.max(0, own.length - limit))
}

/** 找出库里已有的角色（按名字或别名） */
export function findInLibrary(
  library: Record<string, CharacterCard>,
  name: string,
): CharacterCard | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  for (const card of Object.values(library)) {
    if (card.name === trimmed) return card
    if (card.aliases.includes(trimmed)) return card
  }
  return undefined
}

/** 压成一份给提示词用的「已知角色」名单 */
export function toKnownCast(library: Record<string, CharacterCard>): KnownCastEntry[] {
  return Object.values(library).map((card) => ({
    name: card.name,
    aliases: card.aliases,
    brief: card.persona.summary,
  }))
}

/**
 * 把一个称呼解析到已知角色。
 *
 * 用户写「我跟着前面那个人」时，「前面的人」这一轮里可能被模型当成了一个新称呼；
 * 如果它正好命中已有角色的名字或别名，就归并回去，不要凭空多出一个人设。
 */
export function resolveKnownName(name: string, known: KnownCastEntry[]): KnownCastEntry | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  for (const entry of known) {
    if (entry.name === trimmed) return entry
    if (entry.aliases.includes(trimmed)) return entry
  }
  return null
}
