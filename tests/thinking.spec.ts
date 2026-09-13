import { describe, expect, it, vi, afterEach } from 'vitest'
import { LlmClient } from '@/engine/llm/client'
import { DEFAULT_LLM_SETTINGS, isDeepSeekModel, type LlmSettings } from '@/types/settings'

/**
 * 简单步骤关掉思考模式 —— **只对 DeepSeek**。
 *
 * DeepSeek 的思考模式默认是开的（见 api-docs.deepseek.com 的「思考模式」），
 * 而"这句是台词还是动作""谁背对着谁"这类判断用不上它，关掉会明显变快。
 * 其它服务商的对应字段各家不同，引擎不猜也不碰。
 */

function clientWith(patch: Partial<LlmSettings>) {
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'k',
    model: 'deepseek-flash',
    ...patch,
  }
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

describe('DeepSeek：简单步骤关掉思考模式', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('认得出 DeepSeek 的模型名', () => {
    expect(isDeepSeekModel('deepseek-flash')).toBe(true)
    expect(isDeepSeekModel('deepseek-v4-pro')).toBe(true)
    expect(isDeepSeekModel('DeepSeek-Chat')).toBe(true)
    expect(isDeepSeekModel('gpt-5')).toBe(false)
    expect(isDeepSeekModel('qwen-plus')).toBe(false)
    expect(isDeepSeekModel('')).toBe(false)
  })

  it('标了 thinking: false 的步骤，请求体里带上关闭参数', async () => {
    const bodies = captureBody()
    await clientWith({}).chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })

    expect(bodies[0].thinking).toEqual({ type: 'disabled' })
  })

  it('导演和演员照常开着思考 —— 没标就不加参数', async () => {
    const bodies = captureBody()
    const client = clientWith({})

    await client.chatJson([{ role: 'user', content: 'hi' }], { label: 'situation', parse: (raw) => raw })
    await client.chatJson([{ role: 'user', content: 'hi' }], {
      label: 'roleplay:林砚',
      thinking: true,
      parse: (raw) => raw,
    })

    expect(bodies[0].thinking).toBeUndefined()
    expect(bodies[1].thinking).toBeUndefined()
  })

  it('不是 DeepSeek 的模型，一个字段都不加', async () => {
    const bodies = captureBody()
    await clientWith({ model: 'gpt-5' }).chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })

    expect(bodies[0].thinking).toBeUndefined()
  })

  it('用户把简单步骤那一项关掉时，DeepSeek 也不加', async () => {
    const bodies = captureBody()
    await clientWith({ deepseekNoThinkingSimple: false }).chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })

    expect(bodies[0].thinking).toBeUndefined()
  })

  it('两个开关各管各的：打开「复杂步骤也不思考」只影响复杂步骤', async () => {
    const bodies = captureBody()
    const client = clientWith({ deepseekNoThinkingAll: true })

    // 简单步骤本来就不思考
    await client.chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })
    // 复杂步骤这下也关掉
    await client.chatJson([{ role: 'user', content: 'hi' }], { label: 'situation', parse: (raw) => raw })

    expect(bodies[0].thinking).toEqual({ type: 'disabled' })
    expect(bodies[1].thinking).toEqual({ type: 'disabled' })
  })

  it('「复杂步骤也不思考」关着时，导演照常开着思考', async () => {
    const bodies = captureBody()
    await clientWith({ deepseekNoThinkingAll: false }).chatJson(
      [{ role: 'user', content: 'hi' }],
      { label: 'roleplay:林砚', parse: (raw) => raw },
    )

    expect(bodies[0].thinking).toBeUndefined()
  })

  it('别的请求参数原样保留', async () => {
    const bodies = captureBody()
    await clientWith({}).chatJson([{ role: 'user', content: 'hi' }], {
      label: 'segment',
      thinking: false,
      parse: (raw) => raw,
    })

    expect(bodies[0].model).toBe('deepseek-flash')
    expect(bodies[0]).toHaveProperty('messages')
  })
})
