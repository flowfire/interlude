import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 导演有权给成人向踩刹车。
 *
 * 他描写完那段剧情之后可以宣告「这一幕的成人向结束了」，
 * 客户端据此自动取消 R18 勾选 —— 免得用户勾了一次就一路挂着，
 * 陷进没完没了的 R18。关掉之后他随时可以再勾回来。
 */

const h = vi.hoisted(() => ({ r18Ended: false, situationPrompts: [] as string[] }))

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
        backstory: '',
        reason: '',
        holdUp: '',
        routes: [],
        r18Streak: 1,
        sexScore: 0,
        prevSexScore: 0,
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
      chatJson: async (
        messages: { role: string; content: string }[],
        options: { label?: string; parse: (raw: unknown) => unknown },
      ) => {
        const label = options.label ?? ''
        if (label === 'situation') h.situationPrompts.push(messages.map((m) => m.content).join('\n'))
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

async function freshWorkspace() {
  useAppStore.getState().resetWorkspace()
  useAppStore.getState().setProject({ researchEnabled: false })
}

async function runR18Round(input: string, direct = true) {
  const round = useAppStore.getState().newRound(input, 'r18', false, direct)
  await runRoundFor(round.id)
  return round
}

async function runOneRound() {
  await freshWorkspace()
  return runR18Round('我把门关上了。')
}

describe('导演可以宣告成人向收尾', () => {
  beforeEach(() => {
    h.r18Ended = false
    h.situationPrompts.length = 0
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

  it('连着几轮成人向，轮次与历史评分一起回放给导演', async () => {
    await freshWorkspace()
    await runR18Round('第一轮：我把门关上了。')
    expect(h.situationPrompts.at(-1)).toContain('这是第一轮，还没有历史评分')

    await runR18Round('第二轮：我坐下了。')
    expect(h.situationPrompts.at(-1)).toContain('现在要打的是第 2 轮')
    // 上一轮它自己打的分会被回放给它 —— 它自己看得到有没有在涨
    expect(h.situationPrompts.at(-1)).toContain('最近几轮你自己打的分')

    // 中间断一轮普通分级，计数就该断
    const plain = useAppStore.getState().newRound('第三轮：我只是坐着。', 'general')
    await runRoundFor(plain.id)
    await runR18Round('第四轮：我又把门关上了。')
    expect(h.situationPrompts.at(-1)).toContain('现在要打的是第 1 轮')
  })

  it('压力计数会写进产物里 —— 页面上那个数字得有来源', async () => {
    await freshWorkspace()
    await runR18Round('第一轮：我把门关上了。')
    await runR18Round('第二轮：我坐下了。')

    const step = Object.values(useAppStore.getState().steps).find(
      (item) => item.stage === 'situation' && item.roundId === useAppStore.getState().rounds[1].id,
    )
    const state = step?.output as { r18Streak?: number } | undefined
    expect(state?.r18Streak).toBe(2)
  })

  it('引擎把上一轮的分写进产物 —— 界面才能判「没涨 = 不合格」', async () => {
    await freshWorkspace()
    // 第一轮：situation 返回 sexScore 0，prevSexScore 也按 0 算
    await runR18Round('第一轮：我把门关上了。')
    const first = Object.values(useAppStore.getState().steps).find(
      (item) => item.stage === 'situation' && item.roundId === useAppStore.getState().rounds[0].id,
    )
    expect((first?.output as { prevSexScore?: number })?.prevSexScore).toBe(0)

    // 第二轮：引擎必须把第一轮那个分带过来当 prevSexScore
    await runR18Round('第二轮：我坐下了。')
    const second = Object.values(useAppStore.getState().steps).find(
      (item) => item.stage === 'situation' && item.roundId === useAppStore.getState().rounds[1].id,
    )
    const out = second?.output as { prevSexScore?: number; sexScore?: number } | undefined
    expect(out?.prevSexScore).toBe(0)
    // 两轮都是 0 → 后者没比前者高 → 界面上会被标成不合格
    expect(out?.sexScore).toBe(0)
  })

  it('退出去之后用户还能再勾回来', () => {
    // 自动退出只是把勾选框复原，不写死任何东西
    useAppStore.getState().setComposer({ rating: 'r18', direct: true })
    expect(useAppStore.getState().composer).toEqual({ rating: 'r18', direct: true })
  })
})
