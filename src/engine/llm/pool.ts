/**
 * 并发池：限制同时在飞的请求数。
 * 默认上限 4，避免触发厂商的速率限制。
 */
export function createPool(limit: number) {
  const max = Math.max(1, Math.floor(limit) || 1)
  let active = 0
  const queue: Array<() => void> = []

  const release = () => {
    active -= 1
    const next = queue.shift()
    if (next) next()
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active += 1
    try {
      return await task()
    } finally {
      release()
    }
  }
}

/** 顺序执行，遇到失败继续（返回 { ok, value | error }） */
export async function settledMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = []
  for (let i = 0; i < items.length; i += 1) {
    try {
      out.push({ ok: true, value: await mapper(items[i], i) })
    } catch (error) {
      out.push({ ok: false, error })
    }
  }
  return out
}
