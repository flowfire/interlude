/**
 * 从模型输出里尽力挖出 JSON。
 * 模型经常会在 JSON 前后加解释、用 ```json 包裹、或留下尾逗号。
 */

const FENCE_RE = /```(?:json|JSON)?\s*([\s\S]*?)```/

/** 扫描出第一个平衡的 {...} 或 [...] 片段 */
function sliceBalanced(text: string): string | null {
  const startIdx = (() => {
    const a = text.indexOf('{')
    const b = text.indexOf('[')
    if (a === -1) return b
    if (b === -1) return a
    return Math.min(a, b)
  })()
  if (startIdx === -1) return null

  const open = text[startIdx]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(startIdx, i + 1)
    }
  }
  return null
}

/** 轻量修复：去掉对象/数组里的尾随逗号 */
function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\uff0c]/g, ',')
}

export class JsonParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
    this.name = 'JsonParseError'
  }
}

/** 尽最大努力把文本解析成 JSON；失败抛 JsonParseError */
export function extractJson(text: string): unknown {
  const raw = text ?? ''
  const candidates: string[] = []

  const trimmed = raw.trim()
  if (trimmed) candidates.push(trimmed)

  const fenced = FENCE_RE.exec(raw)
  if (fenced?.[1]) candidates.push(fenced[1].trim())

  const balanced = sliceBalanced(raw)
  if (balanced) candidates.push(balanced)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* 继续尝试下一种 */
    }
    try {
      return JSON.parse(repairJson(candidate))
    } catch {
      /* 继续尝试下一种 */
    }
  }

  throw new JsonParseError('模型输出中找不到合法 JSON', raw)
}

/** 解析成对象（数组会被包装成 { items: [...] } 由调用方处理） */
export function extractJsonObject(text: string): Record<string, unknown> {
  const value = extractJson(text)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (Array.isArray(value)) {
    return { items: value }
  }
  throw new JsonParseError('模型输出的 JSON 不是对象', text)
}
