import { LlmError, type ChatMessage, type ChatOptions, type ChatResult, type ChatUsage } from '@/types/llm'
import type { LlmSettings } from '@/types/settings'
import { extractJson } from './json'

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 522, 524])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractContent(payload: unknown): string {
  const root = payload as Record<string, any> | null
  const choice = root?.choices?.[0]
  const message = choice?.message ?? choice?.delta ?? {}
  const content = message?.content

  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : (part?.text ?? part?.content ?? '')))
      .join('')
  }
  if (typeof choice?.text === 'string') return choice.text
  return ''
}

function extractUsage(payload: unknown): ChatUsage {
  const usage = (payload as Record<string, any> | null)?.usage ?? {}
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  const total = Number(usage.total_tokens ?? 0) || prompt + completion
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new LlmError('尚未配置接口地址（baseUrl）')
  if (/\/chat\/completions$/.test(base)) return base
  return `${base}${path}`
}

function mergeSignals(outer: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs)
  const onOuterAbort = () => controller.abort(outer?.reason)
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason)
    else outer.addEventListener('abort', onOuterAbort)
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    },
  }
}

/**
 * 把用户填的「关闭思维链参数」解析成可以合并进请求体的对象。
 *
 * 填错（不是 JSON、不是对象）就当没填 —— 宁可多花点时间思考，
 * 也不要因为一个设置项写错让整个请求失败。
 */
function noThinkingFields(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export interface ChatJsonOptions extends ChatOptions {
  /** 把解析出来的 JSON 转成期望的结构；抛错会触发一次「修复重试」 */
  parse: (raw: unknown) => unknown
}

export class LlmClient {
  constructor(private readonly getSettings: () => LlmSettings) {}

  get settings(): LlmSettings {
    return this.getSettings()
  }

  get isConfigured(): boolean {
    const s = this.settings
    return Boolean(s.baseUrl?.trim() && s.model?.trim())
  }

  /** 一次普通对话补全，内部处理超时与退避重试 */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const settings = this.settings
    if (!settings.baseUrl?.trim()) throw new LlmError('尚未配置接口地址（baseUrl）')
    if (!settings.model?.trim()) throw new LlmError('尚未配置模型名（model）')

    const maxRetries = Math.max(0, settings.maxRetries)
    let attempt = 0
    let useJsonFormat = Boolean(options.json && settings.useJsonResponseFormat)
    let lastError: unknown

    while (attempt <= maxRetries) {
      const startedAt = performance.now()
      const { signal, cleanup } = mergeSignals(options.signal, settings.timeoutMs || 120000)

      const body: Record<string, unknown> = {
        model: options.model ?? settings.model,
        messages,
        temperature: options.temperature ?? settings.temperaturePrecise,
      }
      if (options.maxTokens) body.max_tokens = options.maxTokens
      if (useJsonFormat) body.response_format = { type: 'json_object' }

      // 简单步骤关掉思维链：字段由用户按服务商自己填，引擎不猜
      if (options.thinking === false) {
        Object.assign(body, noThinkingFields(settings.noThinkingBody))
      }

      try {
        const response = await fetch(joinUrl(settings.baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.apiKey?.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}),
          },
          body: JSON.stringify(body),
          signal,
        })

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          // 有些厂商 / 中转不支持 response_format，自动降级重试一次
          if (response.status === 400 && useJsonFormat) {
            useJsonFormat = false
            cleanup()
            attempt += 1
            continue
          }
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
            cleanup()
            const wait = Math.min(8000, 500 * 2 ** attempt)
            lastError = new LlmError(`HTTP ${response.status}`, response.status, text)
            attempt += 1
            await sleep(wait)
            continue
          }
          throw new LlmError(`接口返回 HTTP ${response.status}`, response.status, text)
        }

        const payload = await response.json()
        const content = extractContent(payload)
        if (!content.trim()) {
          if (attempt < maxRetries) {
            cleanup()
            attempt += 1
            await sleep(400 * 2 ** attempt)
            continue
          }
          throw new LlmError('模型返回了空内容')
        }

        cleanup()
        return {
          content,
          usage: extractUsage(payload),
          model: String((payload as any)?.model ?? body.model),
          ms: Math.round(performance.now() - startedAt),
          retries: attempt,
        }
      } catch (error) {
        cleanup()
        if (options.signal?.aborted) throw error

        const isAbort = error instanceof Error && error.name === 'AbortError'
        const retryable = isAbort || !(error instanceof LlmError) || (error.status !== undefined && RETRYABLE_STATUS.has(error.status))

        if (retryable && attempt < maxRetries) {
          lastError = error
          attempt += 1
          await sleep(Math.min(8000, 500 * 2 ** attempt))
          continue
        }
        throw error
      }
    }

    throw lastError instanceof Error ? lastError : new LlmError('请求失败')
  }

  /**
   * 要求模型输出 JSON：解析失败时会把错误回灌，让它自己修一次。
   */
  async chatJson<T = unknown>(
    messages: ChatMessage[],
    options: ChatJsonOptions,
  ): Promise<{ data: T; result: ChatResult }> {
    const { parse, ...chatOptions } = options
    const conversation = [...messages]
    let lastError: unknown
    let lastContent = ''

    for (let round = 0; round < 2; round += 1) {
      const result = await this.chat(conversation, { ...chatOptions, json: true })
      lastContent = result.content
      try {
        const raw = extractJson(result.content)
        return { data: parse(raw) as T, result }
      } catch (error) {
        lastError = error
        conversation.push({ role: 'assistant', content: result.content.slice(0, 4000) })
        conversation.push({
          role: 'user',
          content:
            `你上一次的输出无法被解析。错误：${error instanceof Error ? error.message : String(error)}\n` +
            '请只输出一个合法的 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏。',
        })
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    throw new LlmError(`模型没有返回可用的 JSON（${detail}）`, undefined, lastContent.slice(0, 1200))
  }
}
