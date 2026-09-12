import { describe, expect, it } from 'vitest'
import { normalizeSegmenterOutput } from '@/engine/stages/s1-segment'
import { normalizeSceneSetup } from '@/engine/stages/s2-scene'
import { normalizeExposure } from '@/engine/stages/s2b-exposure'
import { normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { normalizeRoleplayOutput } from '@/engine/stages/s5-roleplay'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { ContextBundle } from '@/types/character'
import type { Segment } from '@/types/segment'

function bundleOf(name: string): ContextBundle {
  return {
    characterId: stableCharacterId(name),
    name,
    card: {
      id: stableCharacterId(name),
      name,
      aliases: [],
      tier: 'major',
      origin: 'generated',
      canonical: false,
      franchise: '',
      source: 'material',
      canReadMind: false,
      persona: {
        summary: '',
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
    pcName: '我',
    counterpartProfile: '',
    presentNames: ['我', name],
    scene: { time: '', place: '', atmosphere: '', situation: '', opening: [] },
    perceived: [],
    sceneLines: [],
    heard: [],
    seen: [],
    ownThoughts: [],
    ownPriorLines: [],
    mindRead: [],
    pcCues: [],
    knownFacts: [],
    doesNotKnow: [],
    recalled: [],
  }
}

const seg = (id: string, text: string): Segment => ({
  id,
  kind: 'speech',
  text,
  isFact: true,
  lockedByUser: false,
  visibility: 'public',
  confidence: 0.9,
  sourceRange: [0, text.length],
  origin: 'model',
})

/**
 * 之前每个 Raw schema 都对元素做严格校验：模型少写一个字段、或者某个值返回 null，
 * 整个步骤就直接降级（拆解退化成规则预标注、场景构建退化成草稿）。
 * 一个脏元素不该毁掉整步。
 */
describe('模型返回脏数据时不该整步降级', () => {
  it('场景构建：present 里混进 null / 字符串 / 缺 name 的项', () => {
    const raw = {
      inputMode: 'outline',
      place: '废弃汽车旅馆',
      opening: ['雨刚停', null, 123],
      present: [
        null,
        '金刚狼',
        { role: '台阶上的人' }, // 缺 name
        { name: '金刚狼', role: '台阶上的人', active: 'true' },
      ],
      establishedBeats: [null, { kind: 'action' }, { kind: 'action', character: '我', text: '推门出来' }],
    }

    const normalized = normalizeSceneSetup(raw as never, '我')

    expect(normalized.present.map((item) => item.name)).toEqual(['金刚狼'])
    expect(normalized.present[0].active).toBe(true)
    expect(normalized.establishedBeats).toHaveLength(1)
    expect(normalized.establishedBeats[0].text).toBe('推门出来')
    expect(normalized.opening).toEqual(['雨刚停', '123'])
  })

  it('拆解：segments 里混进 null、字符串、空 text', () => {
    const doc = normalizeInput('我说：「走吧。」')
    const raw = {
      segments: [
        null,
        'garbage',
        { text: '' },
        { blockIndex: 0, kind: 'speech', text: '走吧。', speaker: '我', confidence: '0.9' },
      ],
      entities: [null, { kind: 'person' }, { mention: '林砚', kind: 'person', role: 'present' }],
      timeMarkers: [null, { kind: 'elapsed' }],
    }

    const { segments, entities, timeMarkers } = normalizeSegmenterOutput(raw as never, doc, '我')

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('走吧。')
    expect(segments[0].speaker).toBe('我')
    // 视角角色始终在实体表里，脏项被丢掉，好项保留
    expect(entities.map((item) => item.mention).sort()).toEqual(['我', '林砚'])
    expect(timeMarkers).toHaveLength(0)
  })

  it('阵容：characters 里混进 null 和没有名字的项', () => {
    const raw = { characters: [null, 42, { summary: '没有名字' }, { name: '林砚', summary: '话少' }] }
    const cards = normalizeCastResult(raw as never, '我')
    expect(cards.map((card) => card.name)).toEqual(['林砚'])
  })

  it('反应：beats 里混进 null 和缺 text 的项', () => {
    const raw = {
      beats: [null, { kind: 'speech' }, { kind: 'speech', text: '坐吧。' }, 'garbage'],
      inner: '她今天不太一样。',
      mood: '收起了漫不经心',
    }

    const output = normalizeRoleplayOutput(raw as never, bundleOf('林砚'))
    expect(output.beats).toHaveLength(1)
    expect(output.beats[0].text).toBe('坐吧。')
    // inner 单独存放，没被脏 beats 影响
    expect(output.inner).toBe('她今天不太一样。')
  })

  it('外化：cues 里混进 null 和缺 visible 的项', () => {
    const raw = {
      cues: [null, { channel: 'gaze' }, { visible: '目光挪开了', readability: '0.3', leakage: 2 }],
      note: null,
    }

    const cues = normalizeExposure(raw as never)
    expect(cues).toHaveLength(1)
    expect(cues[0].visible).toBe('目光挪开了')
    expect(cues[0].readability).toBeCloseTo(0.3)
    expect(cues[0].leakage).toBe(1)
  })

  it('整段内容全是脏数据时，也只是产出空结果，不会抛错', () => {
    expect(normalizeExposure({ cues: [null, 'x'] } as never)).toEqual([])
    expect(normalizeCastResult({ characters: [null] } as never, '我')).toEqual([])

    const doc = normalizeInput('随便一句话')
    const { segments } = normalizeSegmenterOutput({ segments: [null] } as never, doc, '我')
    expect(segments).toEqual([])
  })

  it('正常的模型输出依然被完整保留', () => {
    const raw = {
      segments: [
        { blockIndex: 0, kind: 'speech', text: '走吧。', speaker: '我' },
      ],
    }
    const doc = normalizeInput('我说：「走吧。」')
    const { segments } = normalizeSegmenterOutput(raw as never, doc, '我')
    expect(segments).toHaveLength(1)
    expect(segments[0].isFact).toBe(true)
    void seg
  })
})
