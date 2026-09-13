import { describe, expect, it, vi } from 'vitest'

/**
 * 场景可以「不变」。
 *
 * 连续几轮待在同一处时，场景构建那一步只需要回一个 {"unchanged": true}；
 * 引擎把上一轮那份原样沿用，页面上也不再插新的场面条
 * （sticky 的上一条会继续吸着，视觉上就是"沿用"）。
 */

const h = vi.hoisted(() => ({
  /** 第几轮的 scene 要回 unchanged */
  unchangedFromRound: 99,
  sceneCalls: 0,
}))

vi.mock('@/engine/llm/instance', () => {
  function build(label: string): unknown {
    if (label === 'segment') {
      return {
        segments: [{ blockIndex: 0, kind: 'speech', text: '你好。', speaker: '我', confidence: 0.9 }],
        entities: [
          { mention: '我', kind: 'person', role: 'pc' },
          { mention: '林砚', kind: 'person', role: 'present' },
        ],
      }
    }
    if (label === 'scene') {
      h.sceneCalls += 1
      if (h.sceneCalls >= h.unchangedFromRound) return { unchanged: true }
      return {
        inputMode: 'dialogue',
        time: '第一天夜里',
        place: '客栈',
        atmosphere: '只有一盏灯',
        opening: ['灯芯爆了一下。'],
        situation: '门关上了。',
        pcProfile: '站在门口。',
        present: [{ name: '林砚', role: '桌边', brief: '看着你', kind: 'character', active: true }],
        establishedBeats: [],
      }
    }
    if (label === 'exposure') return { cues: [] }
    if (label === 'cast') {
      return { characters: [{ name: '林砚', tier: 'major', summary: '话少的人', drive: '等', appearsInInput: true }] }
    }
    if (label === 'perceive') return { entries: [{ name: '林砚', missed: [], distorted: [], extras: [], note: '' }] }
    if (label === 'situation') {
      return { pace: 'build', pressure: '', escalation: '', events: [], order: ['林砚'], directions: [], note: '' }
    }
    if (label.startsWith('roleplay:')) return { beats: [{ kind: 'speech', text: '……' }], inner: '在想事情' }
    return {}
  }

  return {
    llmClient: {
      settings: { baseUrl: 'fake', apiKey: 'fake', model: 'fake', maxConcurrency: 4, timeoutMs: 1000 },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async (_messages: unknown, options: { label?: string; parse: (raw: unknown) => unknown }) => ({
        data: options.parse(build(options.label ?? '')),
        result: { content: '{}', usage: {}, model: 'fake', ms: 1, retries: 0 },
      }),
    },
  }
})

const { useAppStore } = await import('@/store/appStore')
const { runRoundFor } = await import('@/ui/usePipelineActions')

function sceneOf(roundId: string) {
  const step = Object.values(useAppStore.getState().steps).find(
    (item) => item.stage === 'scene' && item.roundId === roundId,
  )
  return step?.output as Record<string, unknown> | undefined
}

async function runRound(input: string) {
  const round = useAppStore.getState().newRound(input, 'general')
  await runRoundFor(round.id)
  return round
}

describe('场景没变时沿用上一轮', () => {
  it('第二轮回 unchanged，场景内容照旧是第一轮那份', async () => {
    h.unchangedFromRound = 99
    h.sceneCalls = 0
    useAppStore.getState().resetWorkspace()
    useAppStore.getState().setProject({ researchEnabled: false })

    const first = await runRound('第一轮：我把门关上了。')
    const firstScene = sceneOf(first.id)
    expect(firstScene?.place).toBe('客栈')
    expect(firstScene?.unchanged).toBe(false)

    // 从这一轮起，场景构建回 unchanged
    h.unchangedFromRound = 2
    const second = await runRound('第二轮：我坐下了。')
    const secondScene = sceneOf(second.id)

    // 内容沿用第一轮，只多一个标记
    expect(secondScene?.place).toBe('客栈')
    expect(secondScene?.opening).toEqual(['灯芯爆了一下。'])
    expect(secondScene?.unchanged).toBe(true)
    // 时间也没被改掉 —— 它仍然是第一轮那个时间
    expect(secondScene?.time).toBe('第一天夜里')
  })

  it('没变的那一轮，界面上不会有新的场面条', async () => {
    // 判定条件就是 unchanged 标记 —— 界面据此不渲染
    const round = useAppStore.getState().rounds[1]
    expect(sceneOf(round.id)?.unchanged).toBe(true)

    const first = useAppStore.getState().rounds[0]
    expect(sceneOf(first.id)?.unchanged).toBe(false)
  })
})
