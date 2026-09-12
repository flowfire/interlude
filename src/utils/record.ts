/**
 * 处理模型返回的脏数据。
 *
 * 模型偶尔会返回 null、字符串、或者少写字段。这些都不该让整个步骤降级 ——
 * 一个脏元素毁掉整步，代价太大。这里统一做「尽力取值」。
 */

export function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

export function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : []
}

/** 取成字符串；对象和数组一律当空处理，避免出现 "[object Object]" */
export function asText(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input === 'object') return ''
  return String(input).trim()
}

/** 取成字符串数组，容忍字符串、数组、以及数组里混进的怪东西 */
export function asTextArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => asText(item)).filter(Boolean)
  }
  const single = asText(input)
  if (!single) return []
  return single
    .split(/[、,，/;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
