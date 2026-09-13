import { describe, expect, it } from 'vitest'
import { ImageError, generateSceneImage, sceneImagePrompt } from '@/engine/image/client'
import { DEFAULT_IMAGE_SETTINGS, findImageProvider } from '@/types/settings'

describe('场面生图', () => {
  it('提示词以环境为主，并明确不要人物正脸', () => {
    const prompt = sceneImagePrompt({
      place: '城南茶馆',
      atmosphere: '雨后的安静',
      opening: ['灯芯爆了一下。'],
      situation: '你推门进去。',
    })
    expect(prompt).toContain('地点：城南茶馆')
    expect(prompt).toContain('灯芯爆了一下。')
    expect(prompt).toContain('不要出现人物的正脸')
  })

  it('没有 Key 就直接说清楚，不发请求', async () => {
    await expect(
      generateSceneImage({ prompt: '一个房间', settings: DEFAULT_IMAGE_SETTINGS }),
    ).rejects.toBeInstanceOf(ImageError)
    await expect(
      generateSceneImage({ prompt: '一个房间', settings: DEFAULT_IMAGE_SETTINGS }),
    ).rejects.toThrow(/API Key/)
  })

  it('没有场景可写时也不硬发', async () => {
    await expect(
      generateSceneImage({ prompt: '   ', settings: { provider: 'minimax', apiKey: 'k' } }),
    ).rejects.toThrow(/没有可以拿来生图/)
  })

  it('打的是 MiniMax 的生成接口，带上模型名和 Key', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { image_urls: ['https://img.example/a.png'] } }),
      } as unknown as Response
    }) as typeof fetch

    try {
      const url = await generateSceneImage({
        prompt: '一个房间',
        settings: { provider: 'minimax', apiKey: 'secret' },
      })
      expect(url).toBe('https://img.example/a.png')
      expect(calls[0].url).toBe(`${findImageProvider('minimax').baseUrl}/image_generation`)
      const body = JSON.parse(String(calls[0].init.body))
      expect(body.model).toBe('image-01')
      expect(body.response_format).toBe('url')
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    } finally {
      globalThis.fetch = original
    }
  })

  it('接口报错时把它的原话带出来，不要吞掉', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ base_resp: { status_code: 1004, status_msg: '鉴权失败' } }),
      }) as unknown as Response) as typeof fetch

    try {
      await expect(
        generateSceneImage({ prompt: '一个房间', settings: { provider: 'minimax', apiKey: 'bad' } }),
      ).rejects.toThrow(/1004.*鉴权失败/s)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('场面图的持久化与自动生图开关', () => {
  it('生成过的图会落盘 —— 刷新不该丢（一次生成要花钱和时间）', async () => {
    const store: Record<string, string> = {}
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      key: () => null,
      length: 0,
      clear: () => {},
    } as unknown as Storage

    try {
      const { saveSceneImages, loadSceneImages } = await import('@/store/localSettings')
      saveSceneImages({ 'round-1': 'https://img.example/a.png' })
      expect(loadSceneImages()).toEqual({ 'round-1': 'https://img.example/a.png' })

      // 脏数据要能挡住 —— 非字符串、空串都不收
      store['interlude.sceneImages'] = JSON.stringify({ ok: 'https://a', bad: 123, empty: '' })
      expect(loadSceneImages()).toEqual({ ok: 'https://a' })
    } finally {
      globalThis.localStorage = original
    }
  })

  it('自动生图默认关着', async () => {
    const { DEFAULT_IMAGE_SETTINGS } = await import('@/types/settings')
    expect(DEFAULT_IMAGE_SETTINGS.autoGenerate ?? false).toBe(false)
  })
})
