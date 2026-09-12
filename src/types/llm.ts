export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResult {
  content: string
  usage: ChatUsage
  model: string
  ms: number
  /** 重试次数（0 表示一次成功） */
  retries: number
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 要求模型输出 JSON */
  json?: boolean
  model?: string
  signal?: AbortSignal
  /** 用于日志/调试的标签 */
  label?: string
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
