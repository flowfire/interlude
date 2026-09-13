import {
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_LLM_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  type ImageSettings,
  type LlmSettings,
  type ProjectSettings,
  TEXT_PROVIDERS,
  findTextProvider,
} from '@/types/settings'
import type { ContentRating } from '@/types/step'

const LLM_KEY = 'interlude.llm'
const PROJECT_KEY = 'interlude.project'
const COMPOSER_KEY = 'interlude.composer'
const IMAGE_KEY = 'interlude.image'

/** 输入区上的一些选择，跨刷新记住 */
export interface ComposerState {
  /** 上次发送时用的分级 —— 延续上一次的勾选，不用每次重勾 */
  rating: ContentRating
  /** 成人向下的「快速入戏」 */
  direct: boolean
}

export const DEFAULT_COMPOSER_STATE: ComposerState = { rating: 'general', direct: false }

function readJson<T>(key: string): Partial<T> | null {
  // 服务端渲染 / 测试环境里没有 localStorage
  if (typeof localStorage === 'undefined') return null
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
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn('[interlude] 写入本地设置失败', key, error)
  }
}

export function loadImageSettings(): ImageSettings {
  const raw = readJson(IMAGE_KEY) as Partial<ImageSettings> | null
  return { ...DEFAULT_IMAGE_SETTINGS, ...(raw ?? {}) }
}

export function saveImageSettings(settings: ImageSettings): void {
  writeJson(IMAGE_KEY, settings)
}

export function loadLlmSettings(): LlmSettings {
  const saved = readJson<Partial<LlmSettings>>(LLM_KEY) ?? {}
  const known = TEXT_PROVIDERS.some((item) => item.id === saved.provider)
  // 加入「选服务商」之前存下的老数据没有 provider，端点和模型名可能是手填的 ——
  // 这时候用预设覆盖掉，免得界面显示 A 家、请求却打到 B 家
  const preset = known ? findTextProvider(saved.provider ?? '') : TEXT_PROVIDERS[0]
  return {
    ...DEFAULT_LLM_SETTINGS,
    ...saved,
    provider: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.model,
  }
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
