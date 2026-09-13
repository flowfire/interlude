import { describe, expect, it } from 'vitest'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { buildPerceiveCandidates } from '@/engine/stages/s3b-perceive'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import type { CharacterCard, ContextBundle, PerceivedEvent } from '@/types/character'
import type { SituationState } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 角色要回应的是**局势**，不是用户。
 *
 * 用户点了「什么都不做」之后，金刚狼该去跟狼群交手，而不是回过头来
 * 继续指挥用户。这里钉住让这件事成立的两个前提：
 * 1. 局面事件必须和 pc 的言行**并列在同一条时间线上**，不能只当背景
 * 2. pc 主动交棒那一轮，要明说「这不是让你去搭话的信号」
 */

function card(name: string): CharacterCard {
  return {
    id: `id-${name}`,
    name,
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '话少的人',
      drive: '把这孩子活着带出去',
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

const situation: SituationState = {
  backstory: '',
  reason: '',
  holdUp: '',
  routes: [],
  r18Streak: 1,
  suggestR18: false,
  sexScore: 0,
  prevSexScore: 0,
  pace: 'escalate',
  r18Ended: false,
  pressure: '狼群在二十步外压成半圆',
  escalation: '再有两三息它们就会扑上来',
  events: [
    { kind: 'ambient', text: '左侧灌木丛里传来一声很低的喉音' },
    { kind: 'scene', text: '最前面那两头伏低了身子' },
  ],
  order: ['金刚狼'],
  directions: [],
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
  present: [{ name: '金刚狼', role: '挡在前面', brief: '没回头', kind: 'character', active: true }],
  establishedBeats: [],
  usedModel: true,
}

function pcSaidNothing(): Segment[] {
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

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  const base = buildContextBundle({
    card: card('金刚狼'),
    segments: pcSaidNothing(),
    cards: [],
    pcName: '我',
    sceneSetup: setup,
    candidates: buildPerceiveCandidates({
      cards: [],
      segments: pcSaidNothing(),
      sceneSetup: setup,
      pcName: '我',
      situation,
    }),
    reception: { missed: [], distorted: [], extras: [] },
  })
  return { ...base, ...overrides }
}

function texts(events: PerceivedEvent[]): string[] {
  return events.map((event) => event.text)
}

describe('局面事件要和时间线并列', () => {
  it('狼扑上来是「发生的事」，不是「眼前的环境」', () => {
    const current = bundle()

    const events = current.perceived.filter((event) => event.kind === 'event')
    expect(texts(events)).toContain('最前面那两头伏低了身子')
    expect(texts(events)).toContain('左侧灌木丛里传来一声很低的喉音')

    // 不能只当背景板
    expect(current.sceneLines).not.toContain('最前面那两头伏低了身子')
  })

  it('它和 pc 的言行排在同一条时间线上，且在世界之后', () => {
    const current = bundle()
    const order = current.perceived.map((event) => event.text)

    const mine = order.indexOf('我听着他的吩咐不动。')
    const wolves = order.indexOf('最前面那两头伏低了身子')
    expect(mine).toBeGreaterThanOrEqual(0)
    expect(wolves).toBeGreaterThan(mine)
  })

  it('渲染出来带〔发生〕标记，和台词、动作区分得开', () => {
    const user = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('〔发生〕最前面那两头伏低了身子')
    expect(user).toContain('〔发生〕左侧灌木丛里传来一声很低的喉音')
  })
})

describe('交棒是只有导演知道的 meta 信息', () => {
  it('角色拿到的提示词里不含任何交棒相关的说法', () => {
    const user = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).not.toContain('【他这一轮什么都没做】')
    expect(user).not.toContain('交棒')
    expect(user).not.toContain('主动权')
  })
})

describe('角色是演员，导演才是导演', () => {
  it('演员也能推动剧情，不只演导演给的那部分', () => {
    const [system] = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })
    expect(system.content).toContain('按这个人的性格，把这一轮演出来')
    // 导演给的是骨架不是笼子
    expect(system.content).toContain('骨架，不是笼子')
    expect(system.content).toContain('你完全可以推动剧情')
    expect(system.content).toContain('下一轮导演会接着处理')
    // 但别人的事仍然不归他
    expect(system.content).toContain('你自己的决定不用等谁来批准')
  })

  it('任务说明要求演出一个具体的人，而不是推动剧情', () => {
    const user = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('把这一轮演出来')
    expect(user).toContain('想推动什么就推动什么')
    expect(user).toContain('让熟悉他的人一眼认出这就是他')
  })
})
