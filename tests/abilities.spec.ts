import { describe, expect, it } from 'vitest'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { renderKnownCast } from '@/engine/prompts/segmenter'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { CharacterCard, ContextBundle, KnownCastEntry, RawCastResult } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { Segment, SegmentKind } from '@/types/segment'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

function segment(id: string, kind: SegmentKind, text: string, extra: Partial<Segment> = {}): Segment {
  return {
    id,
    kind,
    text,
    isFact: false,
    lockedByUser: false,
    visibility: kind === 'inner' ? 'private' : 'public',
    confidence: 0.9,
    sourceRange: [0, text.length],
    origin: 'model',
    ...extra,
  }
}

function setup(): SceneSetup {
  return {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: [],
    situation: '你推门进来',
    pcProfile: '外套湿了一片',
    present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
    establishedBeats: [],
    usedModel: true,
  }
}

function card(overrides: Partial<CharacterCard> & { name: string }): CharacterCard {
  return {
    id: stableCharacterId(overrides.name),
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '一句话简介',
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
    ...overrides,
  } as CharacterCard
}

const PC_INNER = '他果然还是不想让我看出什么'
const READER_ABILITY = '能读到对方此刻具体的念头，但读不到动机和来历'

function bundleFor(reader: CharacterCard, pcCues: ContextBundle['pcCues'] = []): ContextBundle {
  return buildContextBundle({
    card: reader,
    segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
    cards: [reader],
    pcName: '我',
    sceneSetup: setup(),
    pcCues,
  })
}

describe('读心是一段谱系，不是开关', () => {
  it('没有这种能力的角色，你的内心依然不外传', () => {
    const bundle = bundleFor(card({ name: '林砚' }))
    expect(bundle.mindRead).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
    expect(bundle.doesNotKnow.join('|')).toContain('心里在想什么')
  })

  it('有读取能力的角色拿到的是「候选」，并附带能力描述与对方的隐藏程度', () => {
    const bundle = bundleFor(card({ name: '读心者', mindReading: READER_ABILITY }), [
      { visible: '视线挪开了半秒', readability: 0.3, channel: 'gaze', fromIndex: 0, leakage: 0.2 },
    ])

    expect(bundle.mindRead).toHaveLength(1)
    expect(bundle.mindRead[0].text).toBe(PC_INNER)
    // 引擎不替他判断读到多少，只把「能力」和「对方藏得多深」一起交给他
    expect(bundle.mindRead[0].ability).toBe(READER_ABILITY)
    expect(bundle.mindRead[0].leakage).toBeCloseTo(0.2)
  })

  it('对方藏得深，泄漏度就低 —— 这是模型判断「能不能读到」的依据', () => {
    const reader = card({ name: '读心者', mindReading: READER_ABILITY })
    const hidden = bundleFor(reader, [
      { visible: '几乎没有变化', readability: 0.05, channel: 'breath', fromIndex: 0, leakage: 0.05 },
    ])
    const leaking = bundleFor(reader, [
      { visible: '手抖了一下', readability: 0.8, channel: 'body', fromIndex: 0, leakage: 0.9 },
    ])

    expect(hidden.mindRead[0].leakage).toBeLessThan(leaking.mindRead[0].leakage)
  })

  it('只拿得到你的内心，拿不到其他角色的', () => {
    const reader = card({ name: '读心者', mindReading: READER_ABILITY })
    const bundle = buildContextBundle({
      card: reader,
      segments: [
        segment('s1', 'inner', PC_INNER, { subject: ['我'] }),
        segment('s2', 'inner', '他其实在犹豫', { subject: ['林砚'] }),
      ],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(bundle.mindRead.map((item) => item.text)).toEqual([PC_INNER])
    expect(bundle.doesNotKnow.join('|')).toContain('林砚')
  })

  it('提示词里明确说「你未必都能读到」，把判断权交回给模型', () => {
    const bundle = bundleFor(card({ name: '读心者', mindReading: READER_ABILITY }), [
      { visible: '视线挪开了半秒', readability: 0.3, channel: 'gaze', fromIndex: 0, leakage: 0.3 },
    ])

    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content

    expect(user).toContain('你「可能」读到的念头')
    expect(user).toContain(PC_INNER)
    expect(user).toContain(READER_ABILITY)
    // 关键：不是「你读到了」，而是「你未必都能读到」
    expect(user).toContain('未必都能读到')
    expect(user).toContain('由你自己结合两件事判断')
    expect(user).toContain('读不到的部分就当它不存在')
  })

  it('藏得越深，提示词里那个数字越难看懂', () => {
    const bundle = bundleFor(card({ name: '读心者', mindReading: READER_ABILITY }), [
      { visible: '几乎没有变化', readability: 0.05, channel: 'breath', fromIndex: 0, leakage: 0.1 },
    ])
    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('藏得有多深：约 90%')
  })
})

describe('能力与感知会进角色提示词', () => {
  it('能力列进「你能做的事」，并说明超出范围就做不到', () => {
    const bundle = buildContextBundle({
      card: card({
        name: '林砚',
        persona: {
          ...card({ name: 'x' }).persona,
          abilities: ['会开锁', '认得草药'],
          perception: ['闻得出三天前留下的气味'],
        },
      }),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
    })

    const system = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[0].content
    expect(system).toContain('会开锁')
    expect(system).toContain('认得草药')
    expect(system).toContain('超出这个范围的事，你做不到')
    expect(system).toContain('闻得出三天前留下的气味')
  })
})

describe('剧情钩子会让设定自己长出来', () => {
  it('钩子会出现在已知角色名单里', () => {
    const known: KnownCastEntry[] = [
      { name: '林砚', aliases: [], brief: '话少的人', hooks: ['天生招祸，走到哪儿哪儿出事'] },
    ]
    const text = renderKnownCast(known)
    expect(text).toContain('会牵引')
    expect(text).toContain('天生招祸')
  })

  it('场景构建的提示词里带上了钩子，并要求自然地出现', () => {
    const user = buildSceneMessages({
      doc: normalizeInput('我推门进来'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      knownCast: [{ name: '林砚', aliases: [], brief: '', hooks: ['天生招祸'] }],
    })[1].content

    expect(user).toContain('天生招祸')
    expect(user).toContain('自然地')
  })

  it('没有钩子时不会硬塞这一段', () => {
    const user = buildSceneMessages({
      doc: normalizeInput('我推门进来'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      knownCast: [{ name: '林砚', aliases: [], brief: '' }],
    })[1].content

    expect(user).not.toContain('会牵引')
  })
})

describe('mindReading 的解析', () => {
  it('模型没给这一项时是空字符串，等于没有这种能力', () => {
    const raw = { characters: [{ name: '林砚', summary: '话少' }] } as unknown as RawCastResult
    expect(normalizeCastResult(raw, '我')[0].mindReading).toBe('')
  })

  it('给了描述就原样保留 —— 强弱和限制是模型写的，引擎不加工', () => {
    const raw = {
      characters: [
        { name: '甲', mindReading: '只能感觉出对方的情绪，对方善于隐藏时会失准' },
        { name: '乙', mindReading: '能听到没说出口的碎片，只在对方情绪波动时' },
        { name: '丙', mindReading: '能像读剧本一样看到对方此刻的全部想法' },
      ],
    } as unknown as RawCastResult

    const parsed = normalizeCastResult(raw, '我')
    expect(parsed[0].mindReading).toContain('善于隐藏时会失准')
    expect(parsed[1].mindReading).toContain('碎片')
    expect(parsed[2].mindReading).toContain('读剧本')
  })

  it('能力和感知会被解析出来', () => {
    const raw = {
      characters: [
        {
          name: '林砚',
          abilities: ['会开锁', '认得草药'],
          perception: '闻得出三天前的气味',
          hooks: ['天生招祸'],
        },
      ],
    } as unknown as RawCastResult

    const parsed = normalizeCastResult(raw, '我')[0]
    expect(parsed.persona.abilities).toEqual(['会开锁', '认得草药'])
    expect(parsed.persona.perception).toEqual(['闻得出三天前的气味'])
    expect(parsed.persona.hooks).toEqual(['天生招祸'])
  })
})
