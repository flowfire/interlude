import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { stableCharacterId } from '@/engine/stages/s3-cast'
import type { CharacterCard, ContextBundle, HistoryRound } from '@/types/character'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 提示词缓存友好性。
 *
 * 追求的**不是**同一轮里不同角色之间共享前缀 —— 那没多大意义。
 * 追求的是**同一个角色跨轮次**：第 K+1 轮发出去的提示词，
 * 应当以第 K 轮发出去的提示词为前缀，多出来的只有尾部这一小段。
 *
 * 所以「往事」必须是逐轮追加、永不重写的一段段固定文本。
 */

function card(name: string): CharacterCard {
  return {
    id: stableCharacterId(name),
    name,
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: `${name}的概述`,
      speechStyle: '句子很短',
      temperament: ['克制'],
      habits: [],
      background: '',
      signature: [],
      voiceSamples: [],
      canonAnchors: [],
      boundaries: [],
      abilities: [],
      perception: [],
      hooks: [],
    },
    state: { mood: '', location: '' },
    appearsInInput: true,
    evidence: '',
  }
}

function historyRound(index: number): HistoryRound {
  return {
    index,
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    pcProfile: '站在门口没动',
    presentNames: ['我', '林砚', '阿七'],
    sceneLines: [`第 ${index} 轮的环境`],
    events: [{ kind: 'speech', from: '我', text: `第 ${index} 轮我说的话`, self: false }],
    inner: `第 ${index} 轮我心里在想的事`,
  }
}

function bundleFor(name: string, roundIndex: number, history: HistoryRound[]): ContextBundle {
  return {
    characterId: stableCharacterId(name),
    name,
    card: card(name),
    roundIndex,
    pcName: '我',
    counterpartProfile: '站在门口没动',
    presentNames: ['我', '林砚', '阿七'],
    scene: { time: '傍晚', place: '城南茶馆', atmosphere: '雨刚停' },
    perceived: [{ kind: 'speech', from: '我', text: `第 ${roundIndex} 轮我说的话`, self: false }],
    sceneLines: [`第 ${roundIndex} 轮的环境`],
    heard: [],
    seen: [],
    ownThoughts: [`第 ${roundIndex} 轮我在想的事`],
    ownPriorLines: [],
    extras: [],
    pcCues: [],
    knownFacts: [],
    doesNotKnow: ['我的真实想法'],
    recalled: [],
    recap: '',
    history,
  }
}

describe('同一个角色跨轮命中前缀', () => {
  it('system 是纯静态常量：换自由度、换分级、换角色都不变', () => {
    const a = buildRoleplayMessages({ bundle: bundleFor('林砚', 2, []), project: DEFAULT_PROJECT_SETTINGS })
    const b = buildRoleplayMessages({
      bundle: bundleFor('阿七', 5, [historyRound(1)]),
      project: { ...DEFAULT_PROJECT_SETTINGS, freedomLevel: 'high' },
      rating: 'r18',
    })

    expect(a[0].content).toBe(b[0].content)
    expect(a[0].content).not.toContain('自由度')
    expect(a[0].content).not.toContain('成人向')
  })

  it('第 K 轮发出去的东西，整体出现在第 K+1 轮的开头', () => {
    const first = buildRoleplayMessages({
      bundle: bundleFor('林砚', 1, []),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    const second = buildRoleplayMessages({
      bundle: bundleFor('林砚', 2, [historyRound(1)]),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    // 第 1 轮里「从角色设定到最后一件实际接收到的事」这一段
    const cut = first.indexOf('【你自己此刻在想什么（只有你知道）】')
    expect(cut).toBeGreaterThan(0)
    expect(second.startsWith(first.slice(0, cut))).toBe(true)
  })

  it('往事逐轮累加，不做「只看最近两轮」的裁剪', () => {
    const history = [historyRound(1), historyRound(2), historyRound(3)]
    const user = buildRoleplayMessages({
      bundle: bundleFor('林砚', 4, history),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    expect(user).toContain('第 1 轮我说的话')
    expect(user).toContain('第 2 轮我说的话')
    expect(user).toContain('第 3 轮我说的话')
    // 顺序必须是从早到晚
    expect(user.indexOf('第 1 轮我说的话')).toBeLessThan(user.indexOf('第 2 轮我说的话'))
    expect(user.indexOf('第 2 轮我说的话')).toBeLessThan(user.indexOf('第 3 轮我说的话'))
  })

  it('往事里带着他自己当时的心理，也带着他自己说过的话', () => {
    const user = buildRoleplayMessages({
      bundle: bundleFor('林砚', 4, [historyRound(1)]),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    expect(user).toContain('（你当时在想：第 1 轮我心里在想的事）')
  })

  it('会变的东西（本轮设定、这一轮的内容）排在往事后面', () => {
    const user = buildRoleplayMessages({
      bundle: bundleFor('林砚', 2, [historyRound(1)]),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    expect(user.indexOf('第 1 轮我说的话')).toBeLessThan(user.indexOf('第 2 轮我说的话'))
    expect(user.indexOf('第 2 轮我说的话')).toBeLessThan(user.indexOf('【本轮设定】'))
  })
})

describe('真跑起来也是累加的', () => {
  function makeRound(index: number, userInput: string): Round {
    const timestamp = `2024-02-0${index}T00:00:00.000Z`
    return {
      id: `s1-r${index}`,
      sessionId: 's1',
      index,
      userInput,
      stepIds: [],
      rootStepIds: [],
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  function script(round: number, markup: string): Record<string, unknown> {
    return {
      segment: {
        segments: [{ blockIndex: 0, kind: 'speech', text: `我说：「${markup}」`, speaker: '我', confidence: 0.9 }],
        entities: [
          { mention: '我', kind: 'person', role: 'pc' },
          { mention: '林砚', kind: 'person', role: 'present' },
        ],
      },
      scene: {
        inputMode: 'dialogue',
        time: `第${round}天的傍晚`,
        place: '城南茶馆',
        atmosphere: '雨刚停',
        opening: [`第${round}轮的开场画面`],
        situation: `第${round}轮正在发生的事`,
        pcProfile: '站在门口没动。',
        present: [{ name: '林砚', role: '老板', brief: '在擦杯子', kind: 'character', active: true }],
        establishedBeats: [],
      },
      cast: {
        characters: [{ name: '林砚', tier: 'major', summary: '话少的人', appearsInInput: true }],
      },
      roleplay: {
        beats: [{ kind: 'speech', text: `第${round}轮他的回答` }],
        inner: `第${round}轮他在想的事`,
      },
    }
  }

  function recordingClient(scripted: Record<string, unknown>, calls: { label: string; prompt: string }[]) {
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

        const raw = scripted[key]
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

  async function runThreeRounds() {
    const project = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }
    const rounds = [makeRound(1, '我说：「第一轮的话」'), makeRound(2, '我说：「第二轮的话」'), makeRound(3, '我说：「第三轮的话」')]

    let steps: Record<string, never> = {}
    let ledger: never[] = []
    const roleplayPrompts = new Map<number, string>()

    for (const round of rounds) {
      const calls: { label: string; prompt: string }[] = []
      const client = recordingClient(script(round.index, `第${round.index}轮的话`), calls)
      const result = await runFullRound({
        client,
        project,
        round,
        rounds,
        steps: steps as never,
        ledger: ledger as never,
      })
      steps = result.steps as never
      ledger = result.ledger as never
      const roleplay = calls.find((call) => call.label.startsWith('roleplay:'))
      if (roleplay) roleplayPrompts.set(round.index, roleplay.prompt)
    }

    return roleplayPrompts
  }

  it('第 3 轮的角色提示词里，第 1、2 轮的原话都还在', async () => {
    const prompts = await runThreeRounds()
    const third = prompts.get(3) ?? ''

    expect(third).toContain('第1轮的话')
    expect(third).toContain('第1轮他的回答')
    expect(third).toContain('第1轮他在想的事')
    expect(third).toContain('第2轮的话')
    expect(third).toContain('第2轮他在想的事')
    // 第 3 轮自己的内容当然也在
    expect(third).toContain('第3轮的话')
  })

  it('第 2 轮的提示词是第 3 轮提示词的前缀', async () => {
    const prompts = await runThreeRounds()
    const second = prompts.get(2) ?? ''
    const third = prompts.get(3) ?? ''

    // 第 2 轮里「从角色设定到最后一件实际接收到的事」这一段
    const tail = '没轮到你的时候你只是看着、听着。'
    const cut = second.indexOf(tail) + tail.length
    expect(second.indexOf(tail)).toBeGreaterThan(0)
    expect(third.startsWith(second.slice(0, cut))).toBe(true)
  })
})
