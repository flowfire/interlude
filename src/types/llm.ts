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
  /**
   * 这一步要不要思维链。
   *
   * 拆解、信息分发这种只需要基本逻辑的活，开着思维链纯属浪费时间；
   * 导演、演员那种需要"人性"的步骤才值得让模型想一想。
   *
   * 具体往请求体里加什么字段由设置里的「关闭思维链参数」决定 ——
   * 各家服务商的写法不一样（enable_thinking / reasoning_effort / thinking…），
   * 引擎不猜，让你自己填。
   */
  thinking?: boolean
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
