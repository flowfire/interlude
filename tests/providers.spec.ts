import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_LLM_SETTINGS,
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  findImageProvider,
  findTextProvider,
} from '@/types/settings'

/**
 * 模型是「选项式」的：用户只选服务商、填 Key，端点和模型名由预设决定。
 * 这样"端点写错、模型名写错"这类问题就不会落到用户头上。
 */

describe('模型服务商预设', () => {
  it('文字模型只列预设里的那几家，端点与模型名都齐', () => {
    expect(TEXT_PROVIDERS.length).toBeGreaterThan(0)
    for (const provider of TEXT_PROVIDERS) {
      expect(provider.id).toBeTruthy()
      expect(provider.label).toBeTruthy()
      expect(provider.baseUrl).toMatch(/^https:\/\//)
      expect(provider.model).toBeTruthy()
    }
    // 目前只支持 DeepSeek
    expect(TEXT_PROVIDERS.map((item) => item.id)).toEqual(['deepseek'])
  })

  it('生图模型目前只有 MiniMax，端点和接口路径对得上', () => {
    expect(IMAGE_PROVIDERS.map((item) => item.id)).toEqual(['minimax'])

    const minimax = IMAGE_PROVIDERS[0]
    expect(minimax.label).toBe('MiniMax')
    expect(minimax.baseUrl).toBe('https://api.minimax.io/v1')
    expect(minimax.model).toBe('image-01')
    expect(minimax.endpoint).toBe('/image_generation')
  })

  it('选项里没有的 id 退回第一家，不会得到 undefined', () => {
    expect(findTextProvider('没这家').id).toBe(TEXT_PROVIDERS[0].id)
    expect(findImageProvider('也没这家').id).toBe(IMAGE_PROVIDERS[0].id)
  })

  it('默认配置能直接用 —— 默认服务商 + 空 Key', () => {
    expect(DEFAULT_LLM_SETTINGS.provider).toBe('deepseek')
    expect(DEFAULT_LLM_SETTINGS.baseUrl).toBe(findTextProvider('deepseek').baseUrl)
    expect(DEFAULT_LLM_SETTINGS.model).toBe(findTextProvider('deepseek').model)
    expect(DEFAULT_LLM_SETTINGS.apiKey).toBe('')

    expect(DEFAULT_IMAGE_SETTINGS.provider).toBe('minimax')
    expect(DEFAULT_IMAGE_SETTINGS.apiKey).toBe('')
  })
})
