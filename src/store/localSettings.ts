import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  type LlmSettings,
  type ProjectSettings,
} from '@/types/settings'
import type { ContentRating } from '@/types/step'

const LLM_KEY = 'interlude.llm'
const PROJECT_KEY = 'interlude.project'
const COMPOSER_KEY = 'interlude.composer'

/** 输入区上的一些选择，跨刷新记住 */
export interface ComposerState {
  /** 上次发送时用的分级 —— 延续上一次的勾选，不用每次重勾 */
  rating: ContentRating
}

export const DEFAULT_COMPOSER_STATE: ComposerState = { rating: 'general' }

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : null
  } catch (error) {
    console.warn('[interlude] 读取本地设置失败', key, error)
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn('[interlude] 写入本地设置失败', key, error)
  }
}

export function loadLlmSettings(): LlmSettings {
  return { ...DEFAULT_LLM_SETTINGS, ...(readJson<LlmSettings>(LLM_KEY) ?? {}) }
}

export function saveLlmSettings(settings: LlmSettings): void {
  writeJson(LLM_KEY, settings)
}

export function loadProjectSettings(): ProjectSettings {
  return { ...DEFAULT_PROJECT_SETTINGS, ...(readJson<ProjectSettings>(PROJECT_KEY) ?? {}) }
}

export function saveProjectSettings(settings: ProjectSettings): void {
  writeJson(PROJECT_KEY, settings)
}

export function loadComposerState(): ComposerState {
  return { ...DEFAULT_COMPOSER_STATE, ...(readJson<ComposerState>(COMPOSER_KEY) ?? {}) }
}

export function saveComposerState(state: ComposerState): void {
  writeJson(COMPOSER_KEY, state)
}
