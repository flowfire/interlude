import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 导演要求进入成人向 → 客户端替他勾上。
 *
 * 这里测的是**端到端**（真的跑一轮），而不是判据本身 ——
 * 因为出过的 bug 就在"读哪一轮"上：`steps` 里装着所有轮次，
 * 而 `Object.values(steps).find((s) => s.stage === 'situation')` 拿到的是
 * **第 1 轮**那一个。于是第 2 轮导演再怎么要求，界面都毫无反应。
 */

const h = vi.hoisted(() => ({ suggestFor: [] as boolean[], situationCall: 0 }))

vi.mock('@/engine/llm/instance', () => {
  function build(label: string): unknown {
    if (label === 'segment') {
      return {
        segments: [{ blockIndex: 0, kind: 'speech', text: '你好。', speaker: '我', confidence: 0.9 }],
        entities: [],
      }
    }
    if (label === 'scene') {
      return {
        inputMode: 'dialogue', time: '傍晚', place: '巷口', atmosphere: '下雨',
        opening: ['雨还在下。'], situation: '你打了声招呼。', pcProfile: '站在雨里。',
        present: [{ name: '林砚', role: '对面的人', brief: '看着你', kind: 'character', active: true }],
        establishedBeats: [],
      }
    }
    if (label === 'exposure') return { cues: [] }
    if (label === 'cast') {
      return {
        characters: [
          { name: '林砚', tier: 'major', summary: 'x', drive: 'y', appearsInInput: true, aliases: [] },
        ],
      }
    }
    if (label === 'situation') {
      const suggest = h.suggestFor[h.situationCall] ?? false
      h.situationCall += 1
      return {
        pace: 'build', pressure: '', escalation: '', events: [], order: [], directions: [], note: '',
        suggestR18: suggest,
      }
    }
    if (label === 'perceive') return { entries: [] }
    if (label.startsWith('roleplay:')) return { beats: [{ kind: 'speech', text: '……嗯。' }] }
    return {}
  }
  return {
    llmClient: {
      settings: { baseUrl: 'f', apiKey: 'f', model: 'f', maxConcurrency: 4, timeoutMs: 1000 },
      isConfigured: true,
      chat: async () => ({ content: '{}', usage: {}, model: 'f', ms: 1, retries: 0 }),
      chatJson: async (_m: unknown, o: { label?: string; parse: (r: unknown) => unknown }) => ({
        data: o.parse(build(o.label ?? '')),
        result: { content: '{}', usage: {}, model: 'f', ms: 1, retries: 0 },
      }),
    },
  }
})

const { useAppStore } = await import('@/store/appStore')
const { runRoundFor, applyR18Suggestion } = await import('@/ui/usePipelineActions')

beforeEach(() => {
  h.suggestFor.length = 0
  h.situationCall = 0
  useAppStore.getState().resetWorkspace()
  // `resetWorkspace` 不动 composer（用户勾的选择在换对话时保留），测试里手动归零
  useAppStore.getState().setComposer({ rating: 'general', direct: false })
  useAppStore.getState().setError(null)
  useAppStore.getState().setProject({ researchEnabled: false, allowR18: true })
})

describe('导演要求开启成人向', () => {
  it('第一轮没要求、第二轮要求了 —— 第二轮才勾上', async () => {
    h.suggestFor.push(false, true)

    const r1 = useAppStore.getState().newRound('第一轮：我走过去。')
    await runRoundFor(r1.id)
    expect(useAppStore.getState().composer.rating).toBe('general')

    const r2 = useAppStore.getState().newRound('第二轮：我看着他。')
    await runRoundFor(r2.id)
    // 关键：读的必须是**第二轮**的 situation，不能是 steps 里第一个
    expect(useAppStore.getState().composer.rating).toBe('r18')
  })

  it('总闸关着时勾不上，但会说明原因', async () => {
    useAppStore.getState().setProject({ allowR18: false })
    h.suggestFor.push(true)

    const r1 = useAppStore.getState().newRound('我走过去。')
    await runRoundFor(r1.id)

    expect(useAppStore.getState().composer.rating).toBe('general')
    expect(useAppStore.getState().error).toContain('允许使用成人向模式')
  })
})

describe('刷新之后仍然认这个请求', () => {
  it('重新载入工作区后，勾选框会被重新勾上 —— 这是派生事实，不是一次性通知', async () => {
    h.suggestFor.push(true)
    const r1 = useAppStore.getState().newRound('我走过去。')
    await runRoundFor(r1.id)
    expect(useAppStore.getState().composer.rating).toBe('r18')

    // 模拟用户手动取消
    useAppStore.getState().setComposer({ rating: 'general', direct: false })

    // 模拟刷新：把当前状态当成快照重新载入，然后走"挂载时"那道流程
    const state = useAppStore.getState()
    const snapshot = {
      sessions: state.sessions,
      rounds: state.rounds,
      steps: state.steps,
      ledger: state.ledger,
    }
    useAppStore.getState().loadSnapshot(snapshot as never)
    applyR18Suggestion()

    expect(useAppStore.getState().composer.rating).toBe('r18')
  })

  it('总闸关着时，刷新也不会勾上', async () => {
    h.suggestFor.push(true)
    const r1 = useAppStore.getState().newRound('我走过去。')
    await runRoundFor(r1.id)

    useAppStore.getState().setProject({ allowR18: false })
    useAppStore.getState().setComposer({ rating: 'general', direct: false })
    applyR18Suggestion()

    expect(useAppStore.getState().composer.rating).toBe('general')
  })
})
