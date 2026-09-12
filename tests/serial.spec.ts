import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { ContextBundle, PerceivedEvent } from '@/types/character'
import type { Round } from '@/types/step'
import { IDLE_INPUT } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 角色是**挨个**反应的，不是齐声开口。
 *
 * 后开口的人看得见先开口的人已经说了什么做了什么 —— 时间顺序上就是如此。
 * 而谁先谁后，由「局面」（这一场戏的导演）决定。
 */

const PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

const LINYAN_LINE = '林砚先开口说的那句'
const AQI_LINE = '阿七接在后面说的话'

function makeRound(index: number, userInput: string): Round {
  const stamp = `2024-04-0${index}T00:00:00.000Z`
  return {
    id: `s1-r${index}`,
    sessionId: 's1',
    index,
    userInput,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/** order 决定这一轮谁先动 */
function script(order: string[], lines: Record<string, string> = {}): Record<string, unknown> {
  return {
    segment: {
      segments: [
        { blockIndex: 0, kind: 'speech', text: '我说：「你们好。」', speaker: '我', confidence: 0.95 },
      ],
      entities: [
        { mention: '我', kind: 'person', role: 'pc' },
        { mention: '林砚', kind: 'person', role: 'present' },
        { mention: '阿七', kind: 'person', role: 'present' },
      ],
    },
    scene: {
      inputMode: 'dialogue',
      time: '傍晚',
      place: '城南茶馆',
      atmosphere: '雨刚停',
      opening: ['屋里只点了两盏灯。'],
      situation: '你推门进来。',
      pcProfile: '站在门口没动。',
      present: [
        { name: '林砚', role: '靠里那桌', brief: '抬眼看你', kind: 'character', active: true },
        { name: '阿七', role: '柜台后面', brief: '擦着杯子', kind: 'character', active: true },
      ],
      establishedBeats: [],
    },
    cast: {
      // 阵容顺序是「林砚、阿七」，但真正谁先动由局面说了算
      characters: [
        { name: '林砚', tier: 'major', summary: '话少的人', appearsInInput: true },
        { name: '阿七', tier: 'minor', summary: '伙计', appearsInInput: true },
      ],
    },
    perceive: {
      entries: [
        { name: '林砚', missed: [], distorted: [], extras: [], note: '' },
        { name: '阿七', missed: [], distorted: [], extras: [], note: '' },
      ],
    },
    situation: {
      pressure: '两个人都看着你',
      escalation: '再没人开口，这顿茶就凉了',
      events: [],
      order,
      note: '',
    },
    'roleplay:林砚': { beats: [{ kind: 'speech', text: LINYAN_LINE }], inner: '林砚在想' },
    'roleplay:阿七': { beats: [{ kind: 'speech', text: AQI_LINE }], inner: '阿七在想' },
    ...Object.fromEntries(
      Object.entries(lines).map(([name, text]) => [
        `roleplay:${name}`,
        { beats: [{ kind: 'speech', text }], inner: `${name}在想` },
      ]),
    ),
  }
}

interface Recorded {
  label: string
  prompt: string
}

function recordingClient(scripted: Record<string, unknown>, calls: Recorded[]): LlmClient {
  return {
    settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
    isConfigured: true,
    chat: async () => {
      throw new Error('未使用')
    },
    chatJson: async (messages: { role: string; content: string }[], options: ChatJsonOptions) => {
      const label = options.label ?? ''
      calls.push({ label, prompt: messages.map((message) => message.content).join('\n') })
      const raw = scripted[label]
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
  } as unknown as LlmClient
}

function contextOf(
  steps: Record<string, { stage: string; roundId: string; meta?: Record<string, unknown>; output: unknown }>,
  characterName: string,
  roundId?: string,
): ContextBundle | undefined {
  const step = Object.values(steps).find(
    (item) =>
      item.stage === 'context' &&
      item.meta?.characterName === characterName &&
      (!roundId || item.roundId === roundId),
  )
  return step?.output as ContextBundle | undefined
}

function texts(events: PerceivedEvent[]): string[] {
  return events.map((event) => event.text)
}

async function runFirstRound(order: string[]) {
  const calls: Recorded[] = []
  const round = makeRound(1, '我说：「你们好。」')
  const result = await runFullRound({
    client: recordingClient(script(order), calls),
    project: PROJECT,
    round,
    rounds: [round],
    steps: {},
    ledger: [],
  })
  return { result, calls }
}

describe('角色是挨个反应的', () => {
  it('后开口的人，看得到先开口的人刚说了什么', async () => {
    const { result } = await runFirstRound(['林砚', '阿七'])

    const linyan = contextOf(result.steps, '林砚')
    const aqi = contextOf(result.steps, '阿七')

    expect(linyan).toBeTruthy()
    expect(aqi).toBeTruthy()
    // 阿七排在后面，所以林砚的话已经在他眼前发生了
    expect(texts(aqi!.perceived)).toContain(LINYAN_LINE)
    expect(aqi!.perceived.find((event) => event.text === LINYAN_LINE)?.self).toBe(false)
    // 林砚先动，他不会未卜先知
    expect(texts(linyan!.perceived)).not.toContain(AQI_LINE)
  })

  it('顺序由「局面」说了算，不是阵容顺序', async () => {
    const { result } = await runFirstRound(['阿七', '林砚'])

    const linyan = contextOf(result.steps, '林砚')
    const aqi = contextOf(result.steps, '阿七')

    // 这次轮到林砚在后面，于是他看到了阿七的话
    expect(texts(linyan!.perceived)).toContain(AQI_LINE)
    expect(texts(aqi!.perceived)).not.toContain(LINYAN_LINE)
  })

  it('后面的角色串行执行 —— 前一个跑完才轮到下一个', async () => {
    const { result, calls } = await runFirstRound(['林砚', '阿七'])

    const roleplayOrder = calls
      .filter((call) => call.label.startsWith('roleplay:'))
      .map((call) => call.label.replace('roleplay:', ''))
    expect(roleplayOrder).toEqual(['林砚', '阿七'])

    // 后一个的提示词里带着前一个的上下文产物
    const aqiPrompt = calls.find((call) => call.label === 'roleplay:阿七')?.prompt ?? ''
    expect(aqiPrompt).toContain(LINYAN_LINE)

    const lastRoleplay = Object.values(result.steps)
      .filter((step) => step.stage === 'roleplay')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    expect(lastRoleplay.length).toBe(2)
  })

  it('导演漏排的人会被补在最后，不会消失', async () => {
    const { result } = await runFirstRound(['阿七'])
    const linyan = contextOf(result.steps, '林砚')
    // 林砚没被排进去，引擎按阵容顺序把他补在后面 —— 所以他看得到阿七
    expect(texts(linyan!.perceived)).toContain(AQI_LINE)
  })
})

describe('用户主动交棒', () => {
  it('「什么都不做」那一轮，导演拿到的原文不是那句占位文本', async () => {
    const calls: Recorded[] = []
    const round: Round = { ...makeRound(1, IDLE_INPUT), idle: true }

    await runFullRound({
      client: recordingClient(script(['林砚', '阿七']), calls),
      project: PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    const situationPrompt = calls.find((call) => call.label === 'situation')?.prompt ?? ''
    expect(situationPrompt).toContain('用户主动交棒：这一轮他什么都没做')
    expect(situationPrompt).not.toContain(IDLE_INPUT)
  })

  it('那句占位原文不会漏进角色的时间线 —— 交棒只有导演知道', async () => {
    const calls: Recorded[] = []
    const round: Round = { ...makeRound(1, IDLE_INPUT), idle: true }

    const result = await runFullRound({
      client: recordingClient(script(['林砚', '阿七']), calls),
      project: PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    const linyan = contextOf(result.steps, '林砚', 's1-r1')
    const prompt = calls.find((call) => call.label === 'roleplay:林砚')?.prompt ?? ''

    // 精确到那句占位文本：提示词里有一句通用的「哪怕用户什么都没做」是可以的
    expect(prompt).not.toContain(IDLE_INPUT)
    expect(prompt).not.toContain('交棒')
    expect(prompt).not.toContain('主动权')
    // 但这一轮的场面还在，他不是瞎的
    expect((linyan?.perceived.length ?? 0) + (linyan?.sceneLines.length ?? 0)).toBeGreaterThan(0)
  })
})

describe('僵局时导演点名', () => {
  it('被点名的人拿到推力，没被点名的拿不到，用户永远不在名单里', async () => {
    const calls: Recorded[] = []
    const round = makeRound(1, '我站着不动。')
    const scripted = script(['林砚', '阿七'])
    scripted.situation = {
      pressure: '三个人谁也不说话',
      escalation: '再这样下去这壶茶就白沏了',
      events: [],
      order: ['林砚', '阿七'],
      directions: [
        {
          who: '林砚',
          push: '你已经等了他三天，他今天要是不开口，你打算就这么坐到打烊吗。',
          act: '他把杯子放下了 —— 这是他今晚第一次主动做出会发出声音的动作。',
        },
      ],
      note: '',
    }

    const result = await runFullRound({
      client: recordingClient(scripted, calls),
      project: PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    const linyan = contextOf(result.steps, '林砚', 's1-r1')
    const aqi = contextOf(result.steps, '阿七', 's1-r1')
    expect(linyan?.direction?.push).toContain('你已经等了他三天')
    expect(linyan?.direction?.act).toContain('他把杯子放下了')
    expect(aqi?.direction).toBeUndefined()

    const linyanPrompt = calls.find((call) => call.label === 'roleplay:林砚')?.prompt ?? ''
    const aqiPrompt = calls.find((call) => call.label === 'roleplay:阿七')?.prompt ?? ''
    expect(linyanPrompt).toContain('【导演给你的这一轮】')
    expect(linyanPrompt).toContain('他把杯子放下了')
    expect(linyanPrompt).toContain('这件事**必须发生**')
    expect(aqiPrompt).not.toContain('【导演给你的这一轮】')
  })
})

describe('下一轮时，整场都成了往事', () => {
  it('先开口的人也知道了后开口的人上一轮说了什么', async () => {
    const calls: Recorded[] = []
    const round1 = makeRound(1, '我说：「你们好。」')
    const round2 = makeRound(2, '我说：「那我先坐会儿。」')
    const rounds = [round1, round2]

    const first = await runFullRound({
      client: recordingClient(script(['林砚', '阿七']), calls),
      project: PROJECT,
      round: round1,
      rounds,
      steps: {},
      ledger: [],
    })

    const second = await runFullRound({
      client: recordingClient(script(['林砚', '阿七']), calls),
      project: PROJECT,
      round: round2,
      rounds,
      steps: first.steps,
      ledger: first.ledger,
    })

    const linyan = contextOf(second.steps, '林砚', 's1-r2')
    expect(linyan).toBeTruthy()

    // 第 1 轮阿七排在林砚后面，所以林砚当时"还没听到"；
    // 到了第 2 轮，那已经是发生过的事了，应该出现在他的往事里。
    const round1History = linyan!.history.find((item) => item.index === 1)
    expect(round1History).toBeTruthy()
    const remembered = round1History!.events.map((event) => event.text)
    expect(remembered).toContain(LINYAN_LINE)
    expect(remembered).toContain(AQI_LINE)
  })
})
