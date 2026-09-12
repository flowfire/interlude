import { describe, expect, it } from 'vitest'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { buildCastFromPresent, mergeWithPresent, normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { normalizeRoleplayOutput } from '@/engine/stages/s5-roleplay'
import { composeScene } from '@/engine/stages/s7-compose'
import { ensurePresentHasActors, extractNamesFromSegments, normalizeSceneSetup } from '@/engine/stages/s2-scene'
import type { CharacterCard, ContextBundle, RawCastResult, RawRoleplay } from '@/types/character'
import type { RawSceneSetup, ScenePresent, SceneSetup } from '@/types/scene'
import type { Segment, SegmentKind } from '@/types/segment'

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

function card(name: string, appears = true): CharacterCard {
  return {
    id: stableCharacterId(name),
    name,
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    persona: {
      summary: `${name} 的一句话简介`,
      drive: '',
      speechStyle: '话少',
      temperament: ['克制'],
      habits: ['说话前会顿一下'],
      background: '背景',
      signature: [],
      voiceSamples: [],
      canonAnchors: [],
      boundaries: [],
      abilities: [],
      perception: [],
      hooks: [],
    },
    state: { mood: '戒备', location: '茶馆' },
    appearsInInput: appears,
    evidence: '素材里的某一句',
    mindReading: '',
  }
}

function setup(overrides: Partial<SceneSetup> = {}): SceneSetup {
  return {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: ['雨停了，青石板上还积着水洼。'],
    situation: '你推门进来，屋里的人都看了你一眼。',
    pcProfile: '二十出头，外套肩膀湿了一片，站在门口没动。',
    present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
    establishedBeats: [],
    usedModel: true,
    ...overrides,
  }
}

function bundleOf(name: string): ContextBundle {
  return {
    characterId: stableCharacterId(name),
    name,
    card: card(name),
    pcName: '我',
    presentNames: ['我', name],
    counterpartProfile: '（没有额外描写）',
    scene: { time: '', place: '', atmosphere: '' },
    perceived: [],
    sceneLines: [],
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
    pressure: '',
    escalation: '',
    roundIndex: 2,
    history: [],
  }
}

describe('S2 场景构建', () => {
  it('概要输入（我遇到了金刚狼）会把被提到的人算作在场', () => {
    const raw = {
      inputMode: 'outline',
      place: '废弃汽车旅馆门口',
      situation: '你和蹲在台阶上的人打了个照面。',
      opening: ['雨刚停，霓虹招牌歪着。'],
      pcProfile: '站在门口没动。',
      present: [{ name: '金刚狼', role: '台阶上的人', brief: '正低头擦爪子', kind: 'character', active: true }],
      establishedBeats: [],
    } as unknown as RawSceneSetup

    const normalized = normalizeSceneSetup(raw, '我')
    expect(normalized.inputMode).toBe('outline')
    expect(normalized.present.map((item) => item.name)).toEqual(['金刚狼'])
    expect(normalized.opening).toHaveLength(1)
  })

  it('保险丝：模型说没人需要反应，但素材里明明有人，就补回来', () => {
    const present: ScenePresent[] = []
    const segments = [
      segment('s1', 'narration', '我推门进去，看见金刚狼坐在角落里'),
      segment('s2', 'action', '金刚狼抬起头', { subject: ['金刚狼'] }),
    ]

    const fixed = ensurePresentHasActors(present, segments, '我')
    expect(fixed.map((item) => item.name)).toContain('金刚狼')
    expect(fixed.every((item) => item.active)).toBe(true)
  })

  it('保险丝：已有角色时不做多余补充', () => {
    const present: ScenePresent[] = [
      { name: '林砚', role: '', brief: '', kind: 'character', active: true },
    ]
    const segments = [segment('s1', 'action', '阿七擦着杯子', { subject: ['阿七'] })]
    const fixed = ensurePresentHasActors(present, segments, '我')
    expect(fixed.map((item) => item.name)).toEqual(['林砚'])
  })

  it('从素材里抓人名时会排除视角角色与明显不是名字的串', () => {
    const segments = [
      segment('s1', 'speech', '你来了', { speaker: '我' }),
      segment('s2', 'speech', '嗯', { speaker: '林砚' }),
      segment('s3', 'action', '门口的风铃响了一声，他说了什么', {}),
    ]
    const names = extractNamesFromSegments(segments, '我')
    expect(names).toEqual(['林砚'])
  })
})

describe('S3 阵容解析', () => {
  it('不会把视角角色重复建卡，并能解析字符串形式的布尔值', () => {
    const raw = {
      characters: [
        { name: '我', appearsInInput: true },
        { name: '林砚', appearsInInput: 'true', tier: '主要' },
        { name: '阿七', appearsInInput: '否', tier: '路人' },
      ],
    } as unknown as RawCastResult

    const cards = normalizeCastResult(raw, '我')
    expect(cards.map((item) => item.name)).toEqual(['林砚', '阿七'])
    expect(cards[0].tier).toBe('major')
    expect(cards[1].tier).toBe('extra')
  })

  it('角色 id 由名字派生，重跑时保持稳定', () => {
    expect(stableCharacterId('林砚')).toBe(stableCharacterId('林砚'))
    expect(stableCharacterId('林砚')).not.toBe(stableCharacterId('阿七'))
  })

  it('以在场名单为准：名单里的人必有卡，名单外的人被丢掉', () => {
    const modelCards = [card('林砚'), card('无关路人')]
    const present: ScenePresent[] = [
      { name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true },
      { name: '金刚狼', role: '台阶上', brief: '擦爪子', kind: 'character', active: true },
    ]

    const merged = mergeWithPresent(modelCards, present)
    expect(merged.map((item) => item.name)).toEqual(['林砚', '金刚狼'])
    // 模型没给卡的人被补了一张薄卡
    expect(merged[1].persona.summary).toBe('台阶上')
    expect(merged[0].persona.summary).toBe('林砚 的一句话简介')
  })

  it('模型不可用时直接用在场名单建薄卡', () => {
    const cards = buildCastFromPresent([
      { name: '金刚狼', role: '台阶上的人', brief: '擦爪子', kind: 'character', active: true },
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('金刚狼')
    expect(cards[0].appearsInInput).toBe(true)
  })
})

describe('S4 上下文分配（信息隔离是核心安全属性）', () => {
  const segments = [
    segment('s1', 'scene', '雨停了，青石板上还积着水洼'),
    segment('s2', 'inner', '他果然还是不想让我看出什么', { subject: ['林砚'] }),
    segment('s3', 'speech', '路上耽搁了', { speaker: '林砚' }),
    segment('s4', 'action', '把湿伞靠在门边', { subject: ['林砚'] }),
    segment('s5', 'speech', '你来得比我预想的早', { speaker: '我' }),
  ]
  const cards = [card('林砚'), card('阿七')]

  it('别人的内心绝不进入上下文，只会变成一句「你不知道」', () => {
    const bundle = buildContextBundle({
      card: cards[1],
      segments,
      cards,
      pcName: '我',
      sceneSetup: setup({ present: [{ name: '林砚', role: '', brief: '', kind: 'character', active: true }] }),
    })

    const everything = [
      ...bundle.sceneLines,
      ...bundle.heard.map((item) => item.text),
      ...bundle.seen.map((item) => item.text),
      ...bundle.ownThoughts,
      ...bundle.ownPriorLines,
      ...bundle.knownFacts,
    ].join('|')

    expect(everything).not.toContain('他果然还是不想让我看出什么')
    expect(bundle.doesNotKnow.join('|')).toContain('林砚心里在想什么')
  })

  it('自己的内心与已说过的话会给自己，且不会出现在「听到」里', () => {
    const bundle = buildContextBundle({
      card: cards[0],
      segments,
      cards,
      pcName: '我',
      sceneSetup: setup(),
      candidates: [
        { ref: 1, kind: 'speech', text: '路上耽搁了', from: '林砚' },
        { ref: 2, kind: 'action', text: '把湿伞靠在门边', from: '林砚' },
        { ref: 3, kind: 'speech', text: '你来得比我预想的早', from: '我' },
      ],
      reception: { missed: [], distorted: [], extras: [] },
    })

    expect(bundle.ownThoughts.join('|')).toContain('他果然还是不想让我看出什么')
    // 自己说过的话、做过的动作进 ownPriorLines，不进「听到 / 看到」
    expect(bundle.ownPriorLines.join('|')).toContain('路上耽搁了')
    expect(bundle.ownPriorLines.join('|')).toContain('把湿伞靠在门边')
    expect(bundle.heard.map((item) => item.text)).not.toContain('路上耽搁了')
    expect(bundle.seen.map((item) => item.text)).not.toContain('把湿伞靠在门边')
    // 别人（用户）说的话才进「听到」
    expect(bundle.heard.map((item) => item.text)).toContain('你来得比我预想的早')
  })

  it('用户填写的自我人设不会外泄，只给「看得见的样子」', () => {
    const bundle = buildContextBundle({
      card: cards[1],
      segments,
      cards,
      pcName: '我',
      sceneSetup: setup({ pcProfile: '站在门口没动，外套湿了一片。' }),
    })

    expect(bundle.counterpartProfile).toContain('外套湿了一片')
    expect(bundle.doesNotKnow.join('|')).toContain('真实想法')
  })

  it('场面设定与公开信息对所有在场者可见', () => {
    const bundle = buildContextBundle({
      card: cards[1],
      segments,
      cards,
      pcName: '我',
      sceneSetup: setup(),
      candidates: [{ ref: 1, kind: 'scene', text: '雨停了，青石板上还积着水洼' }],
      reception: { missed: [], distorted: [], extras: [] },
    })
    expect(bundle.scene.place).toBe('城南茶馆')
    expect(bundle.sceneLines.join('|')).toContain('雨停了')
  })
})

describe('S5 反应归一化', () => {
  it('内心不会混进节拍里，且节日类型被纠正', () => {
    const raw = {
      beats: [
        { kind: '表情', text: '笑维持了半秒就收住' },
        { kind: '动作', text: '把伞靠在门边' },
        { kind: '台词', text: '坐吧。', addressee: '我' },
      ],
      inner: '她手上没有戴那枚戒指。',
      mood: '收起了玩世不恭',
    } as unknown as RawRoleplay

    const output = normalizeRoleplayOutput(raw, bundleOf('林砚'))
    expect(output.beats.map((beat) => beat.kind)).toEqual(['cue', 'action', 'speech'])
    expect(output.beats[2].addressee).toEqual(['我'])
    expect(output.inner).toBe('她手上没有戴那枚戒指。')
    expect(output.beats.some((beat) => beat.text.includes('戒指'))).toBe(false)
  })

  it('没有说话时会记录沉默理由', () => {
    const output = normalizeRoleplayOutput(
      { beats: [{ kind: 'action', text: '退到柜台后面' }] } as unknown as RawRoleplay,
      bundleOf('阿七'),
    )
    expect(output.beats.some((beat) => beat.kind === 'speech')).toBe(false)
    expect(output.silentReason).toBeTruthy()
  })
})

describe('S7 编排顺序', () => {
  it('场面在最前、你的台词保持锁定、AI 反应排在最后', () => {
    const segments = [
      segment('s1', 'speech', '你来得比我预想的早', { speaker: '我', isFact: true, sourceRange: [0, 9] }),
      segment('s2', 'speech', '路上耽搁了', { speaker: '林砚', sourceRange: [10, 16] }),
    ]

    const scene = composeScene({
      sceneSetup: setup({
        opening: ['雨停了，青石板上还积着水洼。'],
        establishedBeats: [],
      }),
      segments,
      cards: [card('林砚')],
      roleplays: [
        {
          characterId: stableCharacterId('林砚'),
          name: '林砚',
          beats: [
            { kind: 'cue', text: '笑维持了半秒就收住' },
            { kind: 'speech', text: '坐吧。' },
          ],
          inner: '她没戴那枚戒指',
        },
      ],
      pcName: '我',
    })

    const kinds = scene.blocks.map((block) => block.kind)
    expect(kinds[0]).toBe('scene')
    expect(kinds.indexOf('pc-speech')).toBeGreaterThan(0)

    const mine = scene.blocks.filter((block) => block.kind === 'pc-speech' || block.kind === 'pc-action')
    expect(mine.every((block) => block.locked)).toBe(true)
    expect(scene.blocks.some((block) => block.text === '你来得比我预想的早')).toBe(true)

    const materialLine = scene.blocks.find((block) => block.text === '路上耽搁了')
    const cueBlock = scene.blocks.find((block) => block.kind === 'cue')
    expect(materialLine).toBeTruthy()
    expect(cueBlock).toBeTruthy()
    expect(cueBlock!.order).toBeGreaterThan(materialLine!.order)
    expect(scene.reactions).toHaveLength(1)
    expect(scene.reactions[0].inner).toBe('她没戴那枚戒指')
  })

  it('场景构建漏抄了你的台词时，编排会补回来并锁定', () => {
    const segments = [segment('s1', 'speech', '我说：「你来得比我预想的早。」', { speaker: '我', isFact: true })]

    const scene = composeScene({
      sceneSetup: setup({ establishedBeats: [] }),
      segments,
      cards: [],
      roleplays: [],
      pcName: '我',
    })

    const mine = scene.blocks.filter((block) => block.kind === 'pc-speech')
    expect(mine).toHaveLength(1)
    expect(mine[0].locked).toBe(true)
  })
})
