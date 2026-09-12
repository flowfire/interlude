import { describe, expect, it } from 'vitest'
import { composeScene } from '@/engine/stages/s7-compose'
import { buildPerceiveCandidates } from '@/engine/stages/s3b-perceive'
import { buildSituationMessages } from '@/engine/prompts/situation'
import { runSituationStage } from '@/engine/stages/s3c-situation'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { ContextBundle, HistoryRound } from '@/types/character'
import type { SituationState } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import type { LlmClient } from '@/engine/llm/client'

const situation: SituationState = {
  pressure: '狼群在二十步外压成半圆',
  escalation: '再有两三息它们就会扑上来',
  events: [
    { kind: 'ambient', text: '左侧灌木丛里传来一声很低的喉音' },
    { kind: 'scene', text: '最前面那两头伏低了身子' },
  ],
  pace: 'escalate',
  order: ['金刚狼', '阿七'],
  usedModel: true,
}

const setup: SceneSetup = {
  inputMode: 'dialogue',
  time: '夜里',
  place: '林子里',
  atmosphere: '风停了',
  opening: ['火堆只剩下一点红。'],
  situation: '你们被围住了。',
  pcProfile: '站在原地没动。',
  present: [
    { name: '金刚狼', role: '挡在前面', brief: '没回头', kind: 'character', active: true },
    { name: '我', role: 'pc', brief: '听着吩咐不动', kind: 'character', active: false },
  ],
  establishedBeats: [],
  usedModel: true,
}

function segments(): Segment[] {
  return [
    {
      id: 's1',
      kind: 'action',
      text: '我听着他的吩咐不动。',
      subject: ['我'],
      confidence: 1,
      isFact: false,
      lockedByUser: false,
      visibility: 'public',
      sourceRange: [0, 10],
      origin: 'rule',
    },
  ]
}

describe('局面推进：世界自己会往前走', () => {
  it('局面事件会进入信息分发的候选池，编号接着往后续', () => {
    const candidates = buildPerceiveCandidates({
      cards: [],
      segments: segments(),
      sceneSetup: setup,
      pcName: '我',
      situation,
    })

    const texts = candidates.map((item) => item.text)
    expect(texts).toContain('左侧灌木丛里传来一声很低的喉音')
    expect(texts).toContain('最前面那两头伏低了身子')
    // 编号必须连续，分发层是按编号取原文的
    expect(candidates.map((item) => item.ref)).toEqual(candidates.map((_, index) => index + 1))
    // 局面事件排在最后 —— 它是这一轮的推进，不是谁的言行
    expect(texts[texts.length - 1]).toBe('最前面那两头伏低了身子')
  })

  it('局面事件会进时间线，排在用户写的内容之后、角色反应之前', () => {
    const scene = composeScene({
      sceneSetup: setup,
      segments: segments(),
      cards: [],
      roleplays: [{ characterId: 'c1', name: '金刚狼', beats: [{ kind: 'action', text: '侧身让开第一头狼' }] }],
      pcName: '我',
      situation,
    })

    const kinds = scene.blocks.map((block) => block.kind)
    expect(kinds).toContain('world')

    const mine = scene.blocks.findIndex((block) => block.kind === 'pc-action')
    const world = scene.blocks.findIndex((block) => block.kind === 'world')
    const reaction = scene.blocks.findIndex((block) => block.kind === 'action' && block.characterName === '金刚狼')

    expect(mine).toBeGreaterThanOrEqual(0)
    expect(world).toBeGreaterThan(mine)
    expect(reaction).toBeGreaterThan(world)
  })

  it('节奏与上一轮的节奏都会交给导演，避免原地踏步', () => {
    const messages = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我听着他的吩咐不动。'),
      segments: segments(),
      sceneSetup: setup,
      drives: [{ name: '金刚狼', drive: '把这孩子活着带出去', brief: '挡在前面' }],
      previous: { pressure: '狼群在收紧', escalation: '它们会扑上来', pace: 'build' },
    })

    const [system, user] = messages
    // 导演要显式判断节奏，而不是把"快慢"交给角色的长期目标
    expect(system.content).toContain('不要连着两轮都停在 build')
    expect(system.content).toContain('如果用户下一轮什么都不写，剧情还会往前走吗')
    expect(system.content).toContain('"pace"')
    // 上一轮是铺垫，导演得知道
    expect(user.content).toContain('上一轮的节奏：build')
    // 压力要压在具体某个人的目标上
    expect(system.content).toContain('压力要压在**某个人的目标上**')
    expect(user.content).toContain('把这孩子活着带出去')
  })

  it('模型不可用时只降级，不阻断整轮，并沿用上一轮的压力', async () => {
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async () => {
        throw new Error('502')
      },
    } as unknown as LlmClient

    const { output } = await runSituationStage(client, {
      doc: normalizeInput('我听着他的吩咐不动。'),
      segments: segments(),
      sceneSetup: setup,
      cards: [],
      pcName: '我',
      storyTitle: '测试',
      previous: { pressure: '上一轮的压力', escalation: '' },
    })

    expect(output.usedModel).toBe(false)
    expect(output.events).toEqual([])
    expect(output.pressure).toBe('上一轮的压力')
  })
})

/* ------------------------------ 角色提示词 ------------------------------ */

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    characterId: 'c1',
    name: '金刚狼',
    roundIndex: 2,
    pcName: '我',
    counterpartProfile: '站在原地没动',
    presentNames: ['我', '金刚狼'],
    scene: { time: '夜里', place: '林子里', atmosphere: '风停了' },
    pressure: '狼群在二十步外压成半圆',
    escalation: '再有两三息它们就会扑上来',
    perceived: [],
    sceneLines: ['火堆只剩下一点红。'],
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
    card: {
      id: 'c1',
      name: '金刚狼',
      aliases: [],
      tier: 'major',
      origin: 'generated',
      canonical: false,
      franchise: '',
      source: 'material',
      mindReading: '',
      persona: {
        summary: '话少的人',
        drive: '把这个孩子活着带出去，然后回去找自己丢掉的记忆',
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
    },
    ...overrides,
  }
}

describe('角色得有自己的驱动力', () => {
  const user = (extra: Partial<ContextBundle> = {}) =>
    buildRoleplayMessages({ bundle: bundle(extra), project: DEFAULT_PROJECT_SETTINGS })[1].content

  it('角色卡里的「他想要什么」会进提示词', () => {
    expect(user()).toContain('把这个孩子活着带出去')
    expect(user()).toContain('【你想要什么】')
  })

  it('没有写明驱动力时，要求模型自己推断一个并朝它行动', () => {
    const card = bundle().card
    const text = user({ card: { ...card, persona: { ...card.persona, drive: '' } } })
    expect(text).toContain('推断出你此刻最想要的东西')
  })

  it('这一轮的局面与「如果没人动会怎样」也告诉他', () => {
    const text = user()
    expect(text).toContain('狼群在二十步外压成半圆')
    expect(text).toContain('再有两三息它们就会扑上来')
  })

  it('不再强迫角色开口说话', () => {
    const [system] = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })
    expect(system.content).not.toContain('至少要说一句话')
    expect(system.content).toContain('你不是在等用户')
    expect(system.content).toContain('世界也在自己往前走')
  })

  it('往事里也带着当时的局面，回看得到', () => {
    const history: HistoryRound[] = [
      {
        index: 1,
        time: '夜里',
        place: '林子外',
        atmosphere: '',
        pressure: '远处有狼嚎',
        escalation: '它们会顺着味道找过来',
        pcProfile: '',
        presentNames: [],
        sceneLines: [],
        events: [],
        inner: '',
      },
    ]
    const text = user({ history })
    expect(text).toContain('远处有狼嚎')
    expect(text).toContain('它们会顺着味道找过来')
  })
})
