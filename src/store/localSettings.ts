import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  type LlmSettings,
  type ProjectSettings,
} from '@/types/settings'

const LLM_KEY = 'interlude.llm'
const PROJECT_KEY = 'interlude.project'

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
