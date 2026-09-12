import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { renderRecap } from '@/engine/prompts/segmenter'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { ContextBundle } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

const TEST_PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

const ROUND1_SCRIPT: Record<string, unknown> = {
  segment: {
    segments: [
      { blockIndex: 0, kind: 'speech', text: '金刚狼说：「跟我走。」', speaker: '金刚狼', confidence: 0.95 },
      { blockIndex: 1, kind: 'speech', text: '我说：「好。」', speaker: '我', confidence: 0.95 },
    ],
    entities: [
      { mention: '我', kind: 'person', role: 'pc' },
      { mention: '金刚狼', kind: 'person', role: 'present' },
    ],
  },
  scene: {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '废弃汽车旅馆门口',
    atmosphere: '雨刚停',
    opening: ['雨刚停，霓虹招牌歪着。'],
    situation: '金刚狼让你跟他走。',
    pcProfile: '站在门口没动。',
    present: [{ name: '金刚狼', role: '台阶上的人', brief: '正起身', kind: 'character', active: true }],
    establishedBeats: [],
  },
  cast: {
    characters: [
      {
        name: '金刚狼',
        tier: 'major',
        summary: '话少、不爱解释的人',
        signature: ['动手前先活动脖子'],
        appearsInInput: true,
      },
    ],
  },
  roleplay: {
    beats: [
      { kind: 'action', text: '把烟按灭在栏杆上，转身往巷子深处走' },
      { kind: 'speech', text: '跟紧点。' },
    ],
    inner: '这孩子跟不跟得上，看他自己。',
  },
}

const ROUND2_SCRIPT: Record<string, unknown> = {
  segment: {
    segments: [{ blockIndex: 0, kind: 'narration', text: '我跟着前面那个人。', confidence: 0.7 }],
    entities: [],
  },
  // 故意模拟「模型没解析好指代词」：把它当成一个新称呼
  scene: {
    inputMode: 'outline',
    time: '同一天夜里',
    place: '巷子深处',
    atmosphere: '只有远处一盏路灯',
    opening: ['巷子很窄，脚步声在两边墙上弹回来。'],
    situation: '你跟着前面那个人往巷子里走。',
    pcProfile: '脚步放得很轻。',
    present: [
      { name: '前面的人', role: '走在前面', brief: '没回头', kind: 'character', active: true },
      // 顺带一个真·新角色，这样 cast 会走「为新角色建卡」的路径
      { name: '守夜人', role: '巷口的门房', brief: '探头看了一眼', kind: 'character', active: true },
    ],
    establishedBeats: [],
  },
  cast: {
    characters: [{ name: '守夜人', tier: 'extra', summary: '巷口的门房', appearsInInput: true }],
  },
  roleplay: {
    beats: [{ kind: 'speech', text: '……到了。' }],
    inner: '她没问要去哪。',
  },
}

function makeRound(sessionId: string, index: number, userInput: string): Round {
  const timestamp = `2024-01-0${index}T00:00:00.000Z`
  return {
    id: `${sessionId}-r${index}`,
    sessionId,
    index,
    userInput,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** 记录每次调用时真正发出去的提示词 */
function recordingClient(script: Record<string, unknown>, calls: { label: string; prompt: string }[]) {
  const client = {
    settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
    isConfigured: true,
    chat: async () => {
      throw new Error('未使用')
    },
    chatJson: async (messages: { role: string; content: string }[], options: ChatJsonOptions) => {
      const label = options.label ?? ''
      const key = label.startsWith('roleplay:') ? 'roleplay' : label
      calls.push({ label, prompt: messages.map((message) => message.content).join('\n') })

      const raw = script[key]
      if (raw === undefined) throw new Error(`没有为 ${label} 准备响应`)
      return {
        data: options.parse(raw),
        result: {
          content: JSON.stringify(raw),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: 'fake',
          ms: 1,
          retries: 0,
        },
      }
    },
  }

  return client as unknown as LlmClient
}

async function runTwoRounds() {
  const calls: { label: string; prompt: string }[] = []
  const client1 = recordingClient(ROUND1_SCRIPT, calls)
  const client2 = recordingClient(ROUND2_SCRIPT, calls)

  const round1 = makeRound('s1', 1, '金刚狼说：「跟我走。」\n我说：「好。」')
  const round2 = makeRound('s1', 2, '我跟着前面那个人。')
  const rounds = [round1, round2]

  const first = await runFullRound({
    client: client1,
    project: TEST_PROJECT,
    round: round1,
    rounds,
    steps: {},
    ledger: [],
  })

  // 只关心第二轮发出去的提示词
  calls.length = 0

  const second = await runFullRound({
    client: client2,
    project: TEST_PROJECT,
    round: round2,
    rounds,
    steps: first.steps,
    ledger: first.ledger,
  })

  return { first, second, calls }
}

describe('前文剧情要进提示词，不能只给角色卡名单', () => {
  it('第二轮发出去的提示词里带着第一轮实际演了什么', async () => {
    const { calls } = await runTwoRounds()
    const allPrompts = calls.map((call) => call.prompt).join('\n=====\n')

    // 第一轮的剧情本身
    expect(allPrompts).toContain('第 1 轮')
    expect(allPrompts).toContain('跟我走')
    expect(allPrompts).toContain('转身往巷子深处走')

    // 三个需要消歧的阶段都得看到它
    for (const label of ['segment', 'scene', 'cast']) {
      const call = calls.find((item) => item.label === label)
      expect(call, `缺少 ${label} 的调用`).toBeTruthy()
      expect(call!.prompt, `${label} 的提示词里没有前文剧情`).toContain('跟我走')
    }
  })

  it('即使模型把「前面的人」当成新称呼，也会被归并回金刚狼', async () => {
    const { second } = await runTwoRounds()

    const sceneStep = Object.values(second.steps).find((step) => step.roundId === 's1-r2' && step.stage === 'scene')
    const setup = sceneStep?.output as SceneSetup

    // 「前面的人」归并回金刚狼；真正的新角色原样保留
    expect(setup.present.map((item) => item.name)).toEqual(['金刚狼', '守夜人'])

    // 角色库不该多出一个「前面的人」
    const library = Object.values(second.steps)
      .filter((step) => step.stage === 'cast' && step.status === 'done')
      .flatMap((step) => (step.output as { characters: { name: string }[] }).characters)
    expect(library.map((card) => card.name)).not.toContain('前面的人')
    expect(library.map((card) => card.name)).toContain('金刚狼')
  })

  it('第二轮的角色上下文里，记忆也带着第一轮', async () => {
    const { second } = await runTwoRounds()
    const contextStep = Object.values(second.steps).find(
      (step) => step.roundId === 's1-r2' && step.stage === 'context',
    )
    const bundle = contextStep?.output as ContextBundle
    expect(bundle.recalled.length).toBeGreaterThan(0)
    expect(bundle.recalled[0].roundIndex).toBe(1)
  })

  it('渲染前文时会提醒模型别把指代当成新角色', () => {
    const text = renderRecap('── 第 1 轮 ──\n金刚狼：转身往巷子深处走')
    expect(text).toContain('前面已经演过的内容')
    expect(text).toContain('不要新造一个角色')
  })

  it('没有前文时不渲染这一节（第一轮不该凭空多出一段）', () => {
    expect(renderRecap('')).toBe('')
    expect(renderRecap(undefined)).toBe('')
  })
})
