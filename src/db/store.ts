import { createStore, del, get, keys, set } from 'idb-keyval'

/**
 * 极薄的 IndexedDB 封装。
 * 用途：长期剧情会产生大量轮次 / 步骤 / 记忆，localStorage 装不下。
 */
const store = createStore('interlude', 'kv')

export async function dbGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await get<T>(key, store)) ?? undefined
  } catch (error) {
    console.warn('[interlude] IndexedDB 读取失败', key, error)
    return undefined
  }
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value, store)
  } catch (error) {
    console.warn('[interlude] IndexedDB 写入失败', key, error)
  }
}

export async function dbDel(key: string): Promise<void> {
  try {
    await del(key, store)
  } catch (error) {
    console.warn('[interlude] IndexedDB 删除失败', key, error)
  }
}

export async function dbKeys(): Promise<string[]> {
  try {
    const all = await keys(store)
    return all.map(String)
  } catch (error) {
    console.warn('[interlude] IndexedDB 枚举失败', error)
    return []
  }
}

export const DB_KEYS = {
  llmSettings: 'settings.llm',
  projectSettings: 'settings.project',
  sessions: 'workspace.sessions',
  rounds: 'workspace.rounds',
  steps: 'workspace.steps',
  ledger: 'workspace.ledger',
  counters: 'workspace.counters',
} as const
