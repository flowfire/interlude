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
    canReadMind: false,
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

describe('能力决定「能知道什么」：读心是心理不外传的唯一例外', () => {
  it('没有读心能力的角色，你的内心依然不外传', () => {
    const bundle = buildContextBundle({
      card: card({ name: '林砚' }),
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [card({ name: '林砚' })],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(bundle.mindRead).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
    expect(bundle.doesNotKnow.join('|')).toContain('心里在想什么')
  })

  it('有读心能力的角色，会直接拿到你的内心', () => {
    const reader = card({ name: '读心者', canReadMind: true })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(bundle.mindRead).toHaveLength(1)
    expect(bundle.mindRead[0].from).toBe('我')
    expect(bundle.mindRead[0].text).toBe(PC_INNER)

    // 那条「你不知道别人心里在想什么」对他不适用
    expect(bundle.doesNotKnow.join('|')).not.toContain('心里在想什么')
    // 但来历和底牌依然读不到
    expect(bundle.doesNotKnow.join('|')).toContain('来历')
  })

  it('读心者只读到你的内心，读不到别人的', () => {
    const reader = card({ name: '读心者', canReadMind: true })
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

  it('读到的念头会写进角色提示词，并说明「这是读到的，不是猜的」', () => {
    const reader = card({ name: '读心者', canReadMind: true })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
    })

    const messages = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })
    const user = messages[1].content
    expect(user).toContain('你读到的念头')
    expect(user).toContain(PC_INNER)
    expect(user).toContain('不是猜的')
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
    const messages = buildSceneMessages({
      doc: normalizeInput('我推门进来'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      knownCast: [{ name: '林砚', aliases: [], brief: '', hooks: ['天生招祸'] }],
    })
    const user = messages[1].content
    expect(user).toContain('天生招祸')
    expect(user).toContain('自然地')
  })

  it('没有钩子时不会硬塞这一段', () => {
    const messages = buildSceneMessages({
      doc: normalizeInput('我推门进来'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      knownCast: [{ name: '林砚', aliases: [], brief: '' }],
    })
    expect(messages[1].content).not.toContain('会牵引')
  })
})

describe('canReadMind 的取值很保守', () => {
  it('模型没给这一项时，默认按「读不到」处理', () => {
    const raw = { characters: [{ name: '林砚', summary: '话少' }] } as unknown as RawCastResult
    expect(normalizeCastResult(raw, '我')[0].canReadMind).toBe(false)
  })

  it('模型给了字符串形式的 true 才开启', () => {
    const raw = { characters: [{ name: '读心者', canReadMind: 'true' }] } as unknown as RawCastResult
    expect(normalizeCastResult(raw, '我')[0].canReadMind).toBe(true)
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
