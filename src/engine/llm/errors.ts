import { LlmError } from '@/types/llm'

export interface ErrorAdvice {
  /** 一句话说清是什么问题 */
  summary: string
  /** 该怎么修 */
  fix: string
}

function explainStatus(status: number, detail?: string): ErrorAdvice {
  if (status === 401) {
    return {
      summary: 'Key 没通过验证（HTTP 401）',
      fix:
        '检查 API Key：有没有复制完整、有没有多出空格或换行、是不是已经过期或被撤销。' +
        '改完在「设置」里点一次「测试连接」确认。',
    }
  }
  if (status === 402) {
    return { summary: '账户余额不足（HTTP 402）', fix: '去厂商后台充值。' }
  }
  if (status === 403) {
    return {
      summary: 'Key 没有访问这个模型的权限（HTTP 403）',
      fix: '确认这个模型是当前 Key 能用的，或者该 Key 有没有被限制模型范围。',
    }
  }
  if (status === 404) {
    return {
      summary: '接口地址或模型名不对（HTTP 404）',
      fix:
        'baseUrl 一般填到 /v1 为止（例如 https://api.deepseek.com/v1），' +
        '模型名要写厂商文档里的完整名字。',
    }
  }
  if (status === 400) {
    return {
      summary: '请求被接口拒绝（HTTP 400）',
      fix:
        '多半是模型名不对，或者该厂商不支持 response_format —— ' +
        '可以在设置里关掉「使用 response_format: json_object」再试。',
    }
  }
  if (status === 429) {
    return { summary: '触发限流（HTTP 429）', fix: '等一会儿再试，或者在设置里把并发上限调低。' }
  }
  if (status >= 500) {
    return { summary: `对方服务端出错（HTTP ${status}）`, fix: '不是你的问题，稍后重试。' }
  }
  return {
    summary: `接口返回 HTTP ${status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
    fix: '在右栏步骤历史里点开这一步看完整报错。',
  }
}

/**
 * 把接口错误翻译成人话。
 * 用户看到「HTTP 401」是不知道要干什么的，得直接告诉他去检查 Key。
 */
export function explainLlmError(error: unknown): ErrorAdvice {
  if (error instanceof LlmError && error.status !== undefined) {
    return explainStatus(error.status, error.body)
  }

  const message = error instanceof Error ? error.message : String(error ?? '')

  // 降级路径上错误已经变成字符串了，从里面把状态码捞出来
  const statusMatch = /HTTP\s+(\d{3})/.exec(message)
  if (statusMatch) return explainStatus(Number(statusMatch[1]))

  if (/Failed to fetch|NetworkError|load failed|ECONNREFUSED/i.test(message)) {
    return {
      summary: '连不上这个接口地址',
      fix:
        '检查 baseUrl 拼写和网络。如果地址没错，可能是这家厂商不允许浏览器直接调用（跨域被拦），' +
        '换一个支持的接口，或者自己搭一个很薄的转发。',
    }
  }
  if (/超时|timeout|aborted/i.test(message)) {
    return { summary: '请求超时', fix: '模型响应太慢。可以在设置里把超时时间调大，或者换个更快的模型。' }
  }
  if (/JSON/i.test(message)) {
    return { summary: '模型没有返回可用的 JSON', fix: '换个更听话的模型，或者关掉 response_format 再试。' }
  }
  if (/空内容/.test(message)) {
    return { summary: '模型返回了空内容', fix: '重试一次；如果反复出现，检查模型名是否正确。' }
  }
  if (/尚未配置/.test(message)) {
    return { summary: '还没有填接口地址或模型名', fix: '打开右上角「设置」补上。' }
  }

  return { summary: message || '未知错误', fix: '' }
}

/** 拼成一行能直接显示给人看的文本 */
export function formatAdvice(advice: ErrorAdvice): string {
  return advice.fix ? `${advice.summary}\n→ ${advice.fix}` : advice.summary
}
