/**
 * 资料检索：给知名角色找一份可用的外部资料。
 *
 * 用维基百科的 REST API —— 免 key、允许跨域。
 * 网络不通（比如在内网或被墙）时静默失败，让阵容解析退回模型自身的知识。
 */

export interface WikiLookup {
  title: string
  extract: string
  url: string
  lang: 'zh' | 'en'
}

const MAX_EXTRACT = 700

async function fetchOne(lang: 'zh' | 'en', name: string, timeoutMs: number): Promise<WikiLookup | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}?redirect=true`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      title?: string
      extract?: string
      type?: string
      content_urls?: { desktop?: { page?: string } }
    }

    const extract = String(data.extract ?? '').trim()
    if (!extract) return null
    // 消歧义页信息量太低，不如让模型用自己的知识
    if (data.type === 'disambiguation') return null

    return {
      title: String(data.title ?? name),
      extract: extract.slice(0, MAX_EXTRACT),
      url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      lang,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 中英文都查一下，取信息量更大的那份 */
export async function lookupWiki(name: string, timeoutMs = 3000): Promise<WikiLookup | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const results = await Promise.allSettled([fetchOne('zh', trimmed, timeoutMs), fetchOne('en', trimmed, timeoutMs)])
  const found: WikiLookup[] = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) found.push(result.value)
  }
  if (!found.length) return null

  return found.sort((a, b) => b.extract.length - a.extract.length)[0]
}

/** 并发查一批名字 */
export async function lookupMany(
  names: string[],
  timeoutMs = 3000,
): Promise<Record<string, WikiLookup>> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  const entries = await Promise.all(
    unique.map(async (name) => {
      const found = await lookupWiki(name, timeoutMs)
      return found ? ([name, found] as const) : null
    }),
  )

  const out: Record<string, WikiLookup> = {}
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1]
  }
  return out
}
