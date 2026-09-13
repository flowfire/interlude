import { describe, expect, it, vi, afterEach } from 'vitest'
import { LlmClient } from '@/engine/llm/client'
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from '@/types/settings'

/**
 * 简单步骤关掉思维链。
 *
 * 拆解、信息分发这种只需要基本逻辑的活，开着思维链纯属浪费时间；
 * 导演、演员那种需要"人性"的步骤才值得让模型想一想。
 * 具体往请求体里加什么字段各家不同，所以由设置里的 JSON 决定 —— 引擎不猜。
 */

function clientWith(patch: Partial<LlmSettings>) {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', ...patch }
  return new LlmClient(() => settings)
}

function captureBody() {
  const bodies: Record<string, unknown>[] = []
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }], usage: {} }),
      text: async () => '{}',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return bodies
}

describe('简单步骤关闭思维链', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没填参数时，请求体原样不动', async () => {
    const bodies = captureBody()
    await clientWith({ noThinkingBody: '' }).chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })

    expect(bodies[0]).not.toHaveProperty('enable_thinking')
    expect(bodies[0]).not.toHaveProperty('reasoning_effort')
  })

  it('标了 thinking: false 的步骤，会把参数合并进请求体', async () => {
    const bodies = captureBody()
    await clientWith({ noThinkingBody: '{"enable_thinking": false}' }).chatJson(
      [{ role: 'user', content: 'hi' }],
      { label: 'segment', thinking: false, parse: (raw) => raw },
    )

    expect(bodies[0].enable_thinking).toBe(false)
  })

  it('没标 thinking 的步骤不受影响 —— 导演和演员照常想', async () => {
    const bodies = captureBody()
    const client = clientWith({ noThinkingBody: '{"enable_thinking": false}' })

    await client.chatJson([{ role: 'user', content: 'hi' }], { label: 'situation', parse: (raw) => raw })
    await client.chatJson([{ role: 'user', content: 'hi' }], {
      label: 'roleplay:林砚',
      thinking: true,
      parse: (raw) => raw,
    })

    expect(bodies[0]).not.toHaveProperty('enable_thinking')
    expect(bodies[1]).not.toHaveProperty('enable_thinking')
  })

  it('参数写坏了就当没填 —— 不能因为一个设置项让请求失败', async () => {
    const bodies = captureBody()
    await clientWith({ noThinkingBody: 'enable_thinking=false' }).chatJson(
      [{ role: 'user', content: 'hi' }],
      { label: 'segment', thinking: false, parse: (raw) => raw },
    )

    expect(bodies[0].enable_thinking).toBeUndefined()
    expect(bodies[0].model).toBe('m')
  })

  it('数组也不算合法参数', async () => {
    const bodies = captureBody()
    await clientWith({ noThinkingBody: '["enable_thinking"]' }).chatJson(
      [{ role: 'user', content: 'hi' }],
      { label: 'segment', thinking: false, parse: (raw) => raw },
    )

    expect(bodies[0]).not.toHaveProperty('0')
    expect(bodies[0].model).toBe('m')
  })
})
