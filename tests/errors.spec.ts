import { describe, expect, it } from 'vitest'
import { explainLlmError, formatAdvice } from '@/engine/llm/errors'
import { LlmError } from '@/types/llm'

describe('把接口错误翻译成人话', () => {
  it('401 会明确让人去检查 Key，而不是甩一个状态码', () => {
    const advice = explainLlmError(new LlmError('接口返回 HTTP 401', 401))
    expect(advice.summary).toContain('401')
    expect(advice.fix).toContain('API Key')
    expect(advice.fix).toContain('测试连接')
  })

  it('402 / 403 / 404 / 429 各有各的说法', () => {
    expect(explainLlmError(new LlmError('x', 402)).summary).toContain('余额')
    expect(explainLlmError(new LlmError('x', 403)).summary).toContain('权限')
    expect(explainLlmError(new LlmError('x', 404)).fix).toContain('/v1')
    expect(explainLlmError(new LlmError('x', 429)).fix).toContain('并发')
  })

  it('5xx 归因到对方服务端，不让人白折腾自己的配置', () => {
    expect(explainLlmError(new LlmError('x', 503)).fix).toContain('稍后重试')
  })

  it('降级路径上错误已经变成字符串，也能从里面认出状态码', () => {
    // 场景构建的 fallbackReason 长这样
    const advice = explainLlmError('接口返回 HTTP 401')
    expect(advice.summary).toContain('401')
    expect(advice.fix).toContain('API Key')
  })

  it('跨域/连不上会被识别出来', () => {
    expect(explainLlmError(new TypeError('Failed to fetch')).summary).toContain('连不上')
  })

  it('超时和 JSON 解析失败也有对应说法', () => {
    expect(explainLlmError(new Error('请求超时')).fix).toContain('超时时间')
    expect(explainLlmError(new Error('模型输出中找不到合法 JSON')).summary).toContain('JSON')
  })

  it('拼出来的文本适合直接显示', () => {
    const text = formatAdvice(explainLlmError(new LlmError('x', 401)))
    expect(text).toContain('\n→ ')
  })

  it('不认识的错误原样带出来，不会吞掉', () => {
    expect(explainLlmError(new Error('某种奇怪的问题')).summary).toBe('某种奇怪的问题')
  })
})
