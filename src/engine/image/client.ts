import { findImageProvider, type ImageSettings } from '@/types/settings'

/**
 * 生图。
 *
 * 目前只接 MiniMax（`POST {baseUrl}/image_generation`，模型 `image-01`）。
 * 它是**手动触发**的：用户在场面卡片上点一下才跑，不参与自动流水线。
 */

export class ImageError extends Error {}

export interface GenerateImageInput {
  prompt: string
  settings: ImageSettings
  /** 画面宽度（px）。默认 1024 —— MiniMax 要求 512~2048 且能被 8 整除 */
  width?: number
  /** 画面高度（px）。默认 576，和宽度凑成 16:9 */
  height?: number
  signal?: AbortSignal
}

/** MiniMax 的返回结构在几种版本里略有差别，挨个试一遍 */
function pickUrl(payload: unknown): string {
  const record = payload as Record<string, unknown> | null
  const data = record?.data as Record<string, unknown> | undefined
  const direct = data?.image_urls
  if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0]

  const images = data?.images
  if (Array.isArray(images)) {
    const first = images[0] as Record<string, unknown> | string | undefined
    if (typeof first === 'string') return first
    if (first && typeof first.url === 'string') return first.url
  }

  const single = data?.image_url ?? data?.url
  if (typeof single === 'string') return single

  return ''
}

export async function generateSceneImage(input: GenerateImageInput): Promise<string> {
  const { settings } = input
  if (!settings.apiKey.trim()) throw new ImageError('还没有填生图模型的 API Key（设置 → 生图模型）')

  const preset = findImageProvider(settings.provider)
  const prompt = input.prompt.trim()
  if (!prompt) throw new ImageError('这一轮没有可以拿来生图的场景描写')

  let response: Response
  try {
    response = await fetch(`${preset.baseUrl.replace(/\/+$/, '')}${preset.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: preset.model,
        prompt,
        // 只够当背景用就行：这张图会被铺满屏幕、压到 18% 透明度再上一层模糊，
        // 高清纯属浪费带宽和等待时间。MiniMax 要求两边都在 512~2048 且能被 8 整除。
        width: input.width ?? 1024,
        height: input.height ?? 576,
        response_format: 'url',
        n: 1,
        prompt_optimizer: true,
      }),
      signal: input.signal,
    })
  } catch (error) {
    // 浏览器直连第三方接口时，最常见的失败是 CORS —— 报文里看不出来，所以点一句
    throw new ImageError(
      `请求没能发出去（${error instanceof Error ? error.message : '网络错误'}）。` +
        '如果接口地址没错，多半是浏览器拦了跨域请求。',
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw new ImageError(`${preset.label} 返回 HTTP ${response.status}：${text.slice(0, 200)}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ImageError(`返回的不是 JSON：${text.slice(0, 200)}`)
  }

  const status = (payload as { base_resp?: { status_code?: number; status_msg?: string } }).base_resp
  if (status && status.status_code !== 0) {
    throw new ImageError(`${preset.label} 报错 ${status.status_code}：${status.status_msg ?? ''}`)
  }

  const url = pickUrl(payload)
  if (!url) throw new ImageError(`返回里没有图片地址：${text.slice(0, 200)}`)
  return url
}

/**
 * 把场景描写拼成给生图模型的提示词。
 *
 * 要点：**画面主体是环境，不是人**。场面图要的是"这是个什么地方"，
 * 人物交给文字去写 —— 生图模型画人脸容易崩，而且会和读者心里的形象打架。
 */
export function sceneImagePrompt(input: {
  place?: string
  atmosphere?: string
  opening?: string[]
  situation?: string
}): string {
  const parts = [
    input.place ? `地点：${input.place}` : '',
    input.atmosphere ? `气氛：${input.atmosphere}` : '',
    ...(input.opening ?? []),
    input.situation ?? '',
  ].filter((line) => line.trim())

  return [
    ...parts,
    '电影感的场景概念图，环境为主，不要出现人物的正脸，不要文字水印。',
  ].join('\n')
}
