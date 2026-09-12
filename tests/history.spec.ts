import { describe, expect, it } from 'vitest'
import { collectHistory } from '@/engine/history'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import type { CharacterCard, ContextBundle, PerceivedEvent } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { Round, Step } from '@/types/step'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 往事必须是**他自己的记忆**，不是一份全知剧本。
 *
 * 两条硬规则：
 * 1. 他不在场的那一轮，内容一个字都不给
 * 2. 别人说的话做的事，不进他的往事
 */

function card(name: string, aliases: string[] = []): CharacterCard {
  return {
    id: `id-${name}`,
    name,
    aliases,
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '',
      drive: '',
      speechStyle: '',
      temperament: [],
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

function round(index: number): Round {
  const stamp = `2024-03-0${index}T00:00:00.000Z`
  return {
    id: `r${index}`,
    sessionId: 's1',
    index,
    userInput: `第${index}轮`,
    stepIds: [],
    rootStepIds: [],
    status: 'done',
    createdAt: stamp,
    updatedAt: stamp,
  }
}

function sceneStep(roundId: string, present: string[]): Step {
  const setup: SceneSetup = {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: [],
    situation: '',
    pcProfile: '',
    present: present.map((name) => ({ name, role: '', brief: '', kind: 'character' as const, active: true })),
    establishedBeats: [],
    usedModel: true,
  }
  return step(roundId, 'scene', setup)
}

function contextStep(roundId: string, owner: CharacterCard, events: PerceivedEvent[], sceneLines: string[]): Step {
  const bundle = {
    characterId: owner.id,
    name: owner.name,
    card: owner,
    roundIndex: 0,
    pcName: '我',
    counterpartProfile: '站在门口没动',
    presentNames: ['我', owner.name],
    scene: { time: '傍晚', place: '城南茶馆', atmosphere: '雨刚停' },
    pressure: '茶快凉了',
    escalation: '再没人开口就散了',
    perceived: events,
    sceneLines,
    heard: [],
    seen: [],
    ownThoughts: [],
    ownPriorLines: [],
    extras: [],
    pcCues: [],
    knownFacts: [],
    doesNotKnow: [],
    recalled: [],
    recap: '',
    history: [],
  } as ContextBundle
  return step(roundId, 'context', bundle, owner.id)
}

function roleplayStep(roundId: string, owner: CharacterCard, texts: string[], inner: string): Step {
  return step(
    roundId,
    'roleplay',
    {
      characterId: owner.id,
      name: owner.name,
      beats: texts.map((text) => ({ kind: 'speech' as const, text })),
      inner,
    },
    owner.id,
  )
}

function step(roundId: string, stage: Step['stage'], output: unknown, characterId?: string): Step {
  const stamp = `2024-03-01T00:00:0${roundId.slice(1)}.000Z`
  return {
    id: `${stage}-${roundId}-${characterId ?? 'x'}`,
    roundId,
    stage,
    label: stage,
    deps: [],
    inputSnapshot: null,
    output,
    meta: characterId ? { characterId } : undefined,
    status: 'done',
    lockedByUser: false,
    editedByUser: false,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

function collect(input: { card: CharacterCard; rounds: Round[]; steps: Step[] }) {
  const index: Record<string, Step> = {}
  for (const item of input.steps) index[item.id] = item
  return collectHistory({
    rounds: input.rounds,
    steps: index,
    card: input.card,
    pcName: '我',
    sessionId: 's1',
    currentRoundId: last(input.rounds).id,
  })
}

function last<T>(items: T[]): T {
  return items[items.length - 1]
}

describe('往事只装他自己经历过的', () => {
  it('他不在场的那一轮，内容一个字都不给，只留一行', () => {
    const linyan = card('林砚')
    const history = collect({
      card: linyan,
      rounds: [round(1), round(2), round(3)],
      steps: [
        sceneStep('r1', ['我', '林砚']),
        contextStep('r1', linyan, [{ kind: 'speech', from: '我', text: '第 1 轮我听到的话', self: false }], []),
        roleplayStep('r1', linyan, ['第 1 轮他自己的回答'], '第 1 轮他的心理'),
        // 第 2 轮林砚不在场，但别人在，剧情照跑
        sceneStep('r2', ['我', '阿七']),
        contextStep('r2', card('阿七'), [{ kind: 'speech', from: '我', text: '第 2 轮的悄悄话', self: false }], ['第 2 轮的场景']),
        sceneStep('r3', ['我', '林砚']),
        contextStep('r3', linyan, [], []),
      ],
    })

    // 第 3 轮是「当前轮」，不进往事；往事是第 1、2 轮
    expect(history).toHaveLength(2)
    expect(history[1].absent).toBe(true)

    const text = history.map((item) => JSON.stringify(item)).join('\n')
    expect(text).not.toContain('第 2 轮的悄悄话')
    expect(text).not.toContain('第 2 轮的场景')
    // 他经历的还在
    expect(text).toContain('第 1 轮我听到的话')
    expect(text).toContain('第 1 轮他自己的回答')
    expect(text).toContain('第 1 轮他的心理')
  })

  it('连续几轮不在场会合并成一行', () => {
    const linyan = card('林砚')
    const history = collect({
      card: linyan,
      rounds: [round(1), round(2), round(3), round(4), round(5)],
      steps: [
        sceneStep('r1', ['我', '林砚']),
        contextStep('r1', linyan, [], []),
        sceneStep('r2', ['我']),
        sceneStep('r3', ['我']),
        sceneStep('r4', ['我']),
        sceneStep('r5', ['我', '林砚']),
        contextStep('r5', linyan, [], []),
      ],
    })

    // 第 5 轮是当前轮；第 2~4 轮他不在场，合并成一条
    expect(history.map((item) => item.index)).toEqual([1, 2])
    expect(history[1].absent).toBe(true)
    expect(history[1].absentThrough).toBe(4)

    const text = buildRoleplayMessages({
      bundle: { ...(contextStep('r5', linyan, [], []).output as ContextBundle), history },
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content
    expect(text).toContain('第 2 轮 ~ 第 4 轮：你不在这里')
  })

  it('用别名认人 —— 卡上写着别名时，也算他在场', () => {
    const linyan = card('林砚', ['砚哥'])
    const history = collect({
      card: linyan,
      rounds: [round(1), round(2)],
      steps: [
        sceneStep('r1', ['我', '砚哥']),
        contextStep('r1', linyan, [{ kind: 'speech', from: '我', text: '认得出他', self: false }], []),
      ],
    })

    expect(history[0].absent).toBeUndefined()
    expect(JSON.stringify(history[0])).toContain('认得出他')
  })

  it('别人的言行不会混进他的往事，他自己说过做过的会留下', () => {
    const linyan = card('林砚')
    const bundle = contextStep(
      'r1',
      linyan,
      [
        { kind: 'speech', from: '我', text: '我对他说的话', self: false },
        { kind: 'action', from: '阿七', text: '阿七当着我的面做的事', self: false },
      ],
      ['环境'],
    ).output as ContextBundle

    const history = collect({
      card: linyan,
      rounds: [round(1), round(2)],
      steps: [
        sceneStep('r1', ['我', '林砚', '阿七']),
        { ...step('r1', 'context', bundle, linyan.id) },
        roleplayStep('r1', linyan, ['他自己说的一句'], '他自己想的'),
        sceneStep('r2', ['我', '林砚']),
        contextStep('r2', linyan, [], []),
      ],
    })

    const texts = history[0].events.map((event) => event.text)
    expect(texts).toContain('我对他说的话')
    expect(texts).toContain('他自己说的一句')
    expect(texts).toContain('阿七当着我的面做的事')

    // 「阿七当着我的面做的事」是**他当时接收到的**（写在 pc 素材里、经感知判定给他的），
    // 所以留下；但阿七自己那一轮的 AI 反应没有进往事。
    const own = history[0].events.filter((event) => event.self).map((event) => event.text)
    expect(own).toEqual(['他自己说的一句'])
  })

  it('第一次出场的角色，往事里全是「你不在场」', () => {
    const newcomer = card('守夜人')
    const history = collect({
      card: newcomer,
      rounds: [round(1), round(2), round(3)],
      steps: [
        sceneStep('r1', ['我', '林砚']),
        sceneStep('r2', ['我', '林砚']),
        sceneStep('r3', ['我', '守夜人']),
        contextStep('r3', newcomer, [], []),
      ],
    })

    // 第 1、2 轮他都不在（当前轮是第 3 轮），合并成一行
    expect(history).toHaveLength(1)
    expect(history[0].absent).toBe(true)
    expect(history[0].absentThrough).toBe(2)
  })
})
