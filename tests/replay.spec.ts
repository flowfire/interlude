import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 「从这一轮重演」应该等价于：
 *   删掉这一轮之后的全部轮次，然后把这一轮的用户输入**原封不动**地重跑一遍。
 *
 * 这条用例直接打 UI 层的 replayFromRound（把全局模型客户端换成脚本化的），
 * 所以验证的是用户真的按下去会发生什么。
 */

const h = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('@/engine/llm/instance', () => {
  function build(label: string): unknown {
    if (label === 'segment') {
      return {
        segments: [
          { blockIndex: 0, kind: 'speech', text: '你好。', speaker: '我', confidence: 0.9 },
        ],
        entities: [
          { mention: '我', kind: 'person', role: 'pc' },
          { mention: '金刚狼', kind: 'person', role: 'present' },
        ],
      }
    }
    if (label === 'scene') {
      return {
        inputMode: 'dialogue',
        time: '傍晚',
        place: '巷口',
        atmosphere: '下雨',
        opening: ['雨还在下。'],
        situation: '你打了声招呼。',
        pcProfile: '站在雨里。',
        present: [
          { name: '金刚狼', role: '对面的人', brief: '看着你', kind: 'character', active: true },
        ],
        establishedBeats: [],
      }
    }
    if (label === 'exposure') return { cues: [] }
    if (label === 'cast') {
      return {
        characters: [{ name: '金刚狼', tier: 'major', summary: '话少的人', drive: '走', appearsInInput: true }],
      }
    }
    if (label === 'perceive') {
      return { entries: [{ name: '金刚狼', missed: [], distorted: [], extras: [], note: '' }] }
    }
    if (label === 'situation') {
      return { pressure: '', escalation: '', events: [], order: ['金刚狼'], directions: [], note: '' }
    }
    if (label.startsWith('roleplay:')) {
      return { beats: [{ kind: 'speech', text: `${label} 的回应` }], inner: '在想事情' }
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
        h.calls.push(label)
        const raw = build(label)
        return {
          data: options.parse(raw),
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
const { runRoundFor, replayFromRound } = await import('@/ui/usePipelineActions')

function stepsOf(roundId: string) {
  return Object.values(useAppStore.getState().steps).filter((step) => step.roundId === roundId)
}

async function seedThreeRounds() {
  const store = useAppStore.getState()
  store.resetWorkspace()
  useAppStore.getState().setProject({ researchEnabled: false })

  const r1 = useAppStore.getState().newRound('第一轮：我走过去。')
  await runRoundFor(r1.id)
  const r2 = useAppStore.getState().newRound('第二轮：我说：「你好。」')
  await runRoundFor(r2.id)
  const r3 = useAppStore.getState().newRound('第三轮：我等着。')
  await runRoundFor(r3.id)

  return { r1, r2, r3 }
}

describe('从这一轮重演', () => {
  beforeEach(() => {
    h.calls.length = 0
    useAppStore.getState().resetWorkspace()
  })

  it('三轮都跑完之后，才谈得上重演', async () => {
    const { r1, r2, r3 } = await seedThreeRounds()
    expect(useAppStore.getState().rounds.map((round) => round.index)).toEqual([1, 2, 3])
    for (const round of [r1, r2, r3]) {
      expect(stepsOf(round.id).length).toBeGreaterThan(0)
    }
  })

  it('重演第二轮：后面那轮连同它的步骤一起消失，前六轮原封不动', async () => {
    const { r1, r2, r3 } = await seedThreeRounds()
    const firstRoundBefore = stepsOf(r1.id)
    const secondRoundBefore = stepsOf(r2.id)

    h.calls.length = 0
    await replayFromRound(r2.id)

    const state = useAppStore.getState()
    expect(state.rounds.map((round) => round.index)).toEqual([1, 2])
    expect(state.rounds.some((round) => round.id === r3.id)).toBe(false)
    // 步骤和账本也要一起清掉，不能留下孤儿
    expect(stepsOf(r3.id)).toHaveLength(0)
    expect(state.ledger.some((entry) => entry.roundId === r3.id)).toBe(false)

    // 前面那些轮次的产物是**同一个对象**，说明根本没被碰过
    const firstRoundAfter = stepsOf(r1.id)
    expect(firstRoundAfter.map((step) => step.output)).toEqual(firstRoundBefore.map((step) => step.output))

    // 重演的这一轮则是全新的产物
    const secondRoundAfter = stepsOf(r2.id)
    expect(secondRoundAfter.map((step) => step.output)).not.toEqual(
      secondRoundBefore.map((step) => step.output),
    )
  })

  it('重演这一轮会把它的流程整条重跑一遍，用户输入不变', async () => {
    const { r2 } = await seedThreeRounds()
    const before = stepsOf(r2.id).length
    const inputBefore = useAppStore.getState().rounds.find((round) => round.id === r2.id)?.userInput

    h.calls.length = 0
    await replayFromRound(r2.id)

    // 拆解 → 场景 → 分发 → 局面 → 上下文 → 反应 全都重新调了一遍
    expect(h.calls).toContain('segment')
    expect(h.calls).toContain('scene')
    expect(h.calls).toContain('perceive')
    expect(h.calls).toContain('situation')
    expect(h.calls.some((label) => label.startsWith('roleplay:'))).toBe(true)
    // 阵容这一步「跑」了，但角色库里已经有金刚狼，所以它复用旧卡、不调模型 ——
    // 这是有意的（人设不漂），不是漏跑

    // 原文一个字都没动
    const inputAfter = useAppStore.getState().rounds.find((round) => round.id === r2.id)?.userInput
    expect(inputAfter).toBe(inputBefore)

    // 步骤树重新长出来了（结构不变，内容是新的）
    expect(stepsOf(r2.id).length).toBe(before)
    expect(useAppStore.getState().rounds.find((round) => round.id === r2.id)?.status).toBe('done')
  })

  it('重演最后一轮时没有东西可丢，但这一轮照样重跑', async () => {
    const { r3 } = await seedThreeRounds()

    h.calls.length = 0
    await replayFromRound(r3.id)

    expect(useAppStore.getState().rounds.map((round) => round.index)).toEqual([1, 2, 3])
    expect(h.calls).toContain('segment')
    expect(h.calls.some((label) => label.startsWith('roleplay:'))).toBe(true)
  })

  it('重演最后一轮也会留下撤销点', async () => {
    const { r3 } = await seedThreeRounds()
    await replayFromRound(r3.id)
    expect(useAppStore.getState().undoLabel).toBe('重演这一轮')
    expect(useAppStore.getState().undoSnapshot).toBeTruthy()
  })

  it('锁定过的步骤不会被重演覆盖', async () => {
    const { r2 } = await seedThreeRounds()
    const segmentStep = stepsOf(r2.id).find((step) => step.stage === 'segment')
    expect(segmentStep).toBeTruthy()

    useAppStore.getState().toggleStepLock(segmentStep!.id)
    const lockedOutput = useAppStore.getState().steps[segmentStep!.id].output

    h.calls.length = 0
    await replayFromRound(r2.id)

    // 锁着的拆解直接复用，所以这次不该再调拆解
    expect(h.calls).not.toContain('segment')
    expect(useAppStore.getState().steps[segmentStep!.id].output).toBe(lockedOutput)
    // 下游照样重跑
    expect(h.calls.some((label) => label.startsWith('roleplay:'))).toBe(true)
  })
})
