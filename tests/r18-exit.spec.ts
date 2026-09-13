import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 导演有权给成人向踩刹车。
 *
 * 他描写完那段剧情之后可以宣告「这一幕的成人向结束了」，
 * 客户端据此自动取消 R18 勾选 —— 免得用户勾了一次就一路挂着，
 * 陷进没完没了的 R18。关掉之后他随时可以再勾回来。
 */

const h = vi.hoisted(() => ({ r18Ended: false }))

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
      return {
        inputMode: 'dialogue',
        time: '夜里',
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
    if (label === 'perceive') {
      return { entries: [{ name: '林砚', missed: [], distorted: [], extras: [], note: '' }] }
    }
    if (label === 'situation') {
      return {
        pace: 'settle',
        r18Ended: h.r18Ended,
        pressure: '',
        escalation: '',
        events: [],
        order: ['林砚'],
        directions: [],
        note: '',
      }
    }
    if (label.startsWith('roleplay:')) {
      return { beats: [{ kind: 'speech', text: '……' }], inner: '在想事情' }
    }
    return {}
  }

  return {
    llmClient: {
      settings: {
        baseUrl: 'fake',
        apiKey: 'fake',
        model: 'fake',
        temperaturePrecise: 0,
        temperatureCreative: 1,
        maxConcurrency: 4,
        timeoutMs: 1000,
      },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async (_messages: unknown, options: { label?: string; parse: (raw: unknown) => unknown }) => {
        const label = options.label ?? ''
        return {
          data: options.parse(build(label)),
          result: {
            content: '{}',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: 'fake',
            ms: 1,
            retries: 0,
          },
        }
      },
    },
  }
})

const { useAppStore } = await import('@/store/appStore')
const { runRoundFor } = await import('@/ui/usePipelineActions')

async function runOneRound() {
  const store = useAppStore.getState()
  store.resetWorkspace()
  useAppStore.getState().setProject({ researchEnabled: false })
  const round = useAppStore.getState().newRound('我把门关上了。', 'r18', false, true)
  await runRoundFor(round.id)
  return round
}

describe('导演可以宣告成人向收尾', () => {
  beforeEach(() => {
    h.r18Ended = false
    useAppStore.getState().setComposer({ rating: 'general', direct: false })
  })

  it('没宣告时，勾选原样留着', async () => {
    useAppStore.getState().setComposer({ rating: 'r18', direct: true })
    await runOneRound()

    expect(useAppStore.getState().composer).toEqual({ rating: 'r18', direct: true })
  })

  it('宣告收尾之后，客户端自动退出成人向模式', async () => {
    useAppStore.getState().setComposer({ rating: 'r18', direct: true })
    h.r18Ended = true

    await runOneRound()

    // 两个勾都落回默认 —— 快速入戏只在成人向那一轮有意义，不能单独留着
    expect(useAppStore.getState().composer).toEqual({ rating: 'general', direct: false })
  })

  it('退出去之后用户还能再勾回来', () => {
    // 自动退出只是把勾选框复原，不写死任何东西
    useAppStore.getState().setComposer({ rating: 'r18', direct: true })
    expect(useAppStore.getState().composer).toEqual({ rating: 'r18', direct: true })
  })
})
