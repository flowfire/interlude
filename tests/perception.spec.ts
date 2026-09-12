import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { buildPerceiveCandidates } from '@/engine/stages/s3b-perceive'
import { normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { renderKnownCast } from '@/engine/prompts/segmenter'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { CharacterCard, ContextBundle, KnownCastEntry, RawCastResult } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { Segment, SegmentKind } from '@/types/segment'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

const TEST_PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

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
    present: [{ name: '听风者', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
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
const SUPERSENSE = '眼观六路，耳听八方，背后有人靠近也能察觉'
const MIND_READING = '能读到对方此刻具体的念头，但读不到动机和来历'

/* ------------------------- 候选池：什么该给判定器看 ------------------------- */

describe('候选池只装「有资格被察觉到」的东西', () => {
  const baseSegments = [
    segment('s1', 'action', '我站在他背后，右手在身侧动了一下', { subject: ['我'] }),
    segment('s2', 'inner', PC_INNER, { subject: ['我'] }),
    segment('s3', 'scene', '屋里只有一盏灯'),
  ]

  it('没有读取能力时，「没说出口的」不进候选池 —— 不能因为多了一层判定就泄露原文', () => {
    const candidates = buildPerceiveCandidates({
      card: card({ name: '听风者', persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] } }),
      name: '听风者',
      segments: baseSegments,
      pcName: '我',
      position: '',
    })

    expect(candidates.some((item) => item.kind === '动作')).toBe(true)
    expect(candidates.some((item) => item.kind === '环境')).toBe(true)
    expect(candidates.some((item) => item.kind === '没说出口的')).toBe(false)
  })

  it('有读取能力时，才把内心放进去', () => {
    const candidates = buildPerceiveCandidates({
      card: card({ name: '读心者', mindReading: MIND_READING }),
      name: '读心者',
      segments: baseSegments,
      pcName: '我',
      position: '',
    })

    expect(candidates.some((item) => item.kind === '没说出口的')).toBe(true)
  })

  it('外化出来的细微表现对所有候选开放（它们是可见的，只是需要敏锐）', () => {
    const candidates = buildPerceiveCandidates({
      card: card({ name: '听风者', persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] } }),
      name: '听风者',
      segments: baseSegments,
      exposure: {
        cues: [{ id: 'c1', hidden: PC_INNER, visible: '视线落到桌面上', channel: 'gaze', leakage: 0.2, readability: 0.15, fromIndex: 0 }],
        note: '',
        hadInner: true,
        usedModel: true,
      },
      pcName: '我',
      position: '',
    })

    expect(candidates.some((item) => item.kind === '细微表现')).toBe(true)
  })
})

/* ------------------------- 单元：上下文只装判定结果 ------------------------- */

describe('上下文里装的是判定结果，不是原文', () => {
  it('没有超常感官的角色，你的内心依然不外传', () => {
    const plain = card({ name: '林砚' })
    const bundle = buildContextBundle({
      card: plain,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [plain],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(bundle.extras).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
    expect(bundle.doesNotKnow.join('|')).toContain('心里在想什么')
  })

  it('有读取能力的角色拿到的只有判定结果 —— 原文一个字都不在', () => {
    const reader = card({ name: '读心者', mindReading: MIND_READING })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
      extras: [{ text: '他好像在防备着什么', channel: 'mind', certainty: 0.4 }],
    })

    expect(bundle.extras).toHaveLength(1)
    expect(bundle.extras[0].channel).toBe('mind')
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
  })

  it('超常感官和读心走的是同一套结构，只是通道不同', () => {
    const listener = card({
      name: '听风者',
      persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] },
    })
    const bundle = buildContextBundle({
      card: listener,
      segments: [],
      cards: [listener],
      pcName: '我',
      sceneSetup: setup(),
      extras: [
        { text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 },
        { text: '空气里有股铁锈味', channel: 'smell', certainty: 0.3 },
      ],
    })

    expect(bundle.extras.map((item) => item.channel)).toEqual(['hearing', 'smell'])
  })

  it('扮演提示词里按通道渲染，并标出把握', () => {
    const listener = card({
      name: '听风者',
      persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] },
    })
    const bundle = buildContextBundle({
      card: listener,
      segments: [],
      cards: [listener],
      pcName: '我',
      sceneSetup: setup(),
      extras: [{ text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 }],
    })

    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('【你额外察觉到的】')
    expect(user).toContain('听到：背后有一声很轻的摩擦（把握 60%）')
    expect(user).toContain('不要表现得比你实际察觉到的更全知')
  })
})

/* ------------------------- 集成：感知判定是独立的一步 ------------------------- */

function makeRound(): Round {
  return {
    id: 'r1',
    sessionId: 's1',
    index: 1,
    userInput: '我绕到他背后。（他果然还是不想让我看出什么）',
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function scriptedClient(perceiveResponse: unknown, castMindReading = '', castPerception: string[] = [SUPERSENSE]) {
  const calls: string[] = []
  const client = {
    settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
    isConfigured: true,
    chat: async () => {
      throw new Error('未使用')
    },
    chatJson: async (_messages: unknown, options: ChatJsonOptions) => {
      const label = options.label ?? ''
      calls.push(label)
      const key = label.startsWith('roleplay:') ? 'roleplay' : label.startsWith('perceive:') ? 'perceive' : label

      const table: Record<string, unknown> = {
        segment: {
          segments: [
            { blockIndex: 0, kind: 'action', text: '我绕到他背后。', subject: ['我'] },
            { blockIndex: 1, kind: 'inner', text: PC_INNER, subject: ['我'], visibility: 'private' },
          ],
          entities: [{ mention: '听风者', kind: 'person', role: 'present' }],
        },
        scene: {
          inputMode: 'dialogue',
          time: '傍晚',
          place: '城南茶馆',
          atmosphere: '',
          opening: [],
          situation: '你绕到他背后',
          pcProfile: '外套湿了一片',
          present: [{ name: '听风者', role: '对面', brief: '在喝茶', kind: 'character', active: true }],
          establishedBeats: [],
        },
        exposure: {
          cues: [{ fromIndex: 0, hidden: PC_INNER, visible: '脚步放得很轻', channel: 'body', leakage: 0.2, readability: 0.15 }],
          note: '',
        },
        cast: {
          characters: [
            {
              name: '听风者',
              tier: 'major',
              summary: '听觉极好的人',
              perception: castPerception,
              mindReading: castMindReading,
              appearsInInput: true,
            },
          ],
        },
        perceive: perceiveResponse,
        roleplay: { beats: [{ kind: 'speech', text: '……你绕到我背后做什么。' }], inner: '脚步声骗不了我。' },
      }

      const raw = table[key]
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
  return { client: client as unknown as LlmClient, calls }
}

async function runOnce(perceiveResponse: unknown, mindReading = '', perception: string[] = [SUPERSENSE]) {
  const { client, calls } = scriptedClient(perceiveResponse, mindReading, perception)
  const round = makeRound()
  const result = await runFullRound({
    client,
    project: TEST_PROJECT,
    round,
    rounds: [round],
    steps: {},
    ledger: [],
  })
  return { result, calls }
}

describe('感知判定是独立的一步，扮演环节拿不到原文', () => {
  it('有超常感官的角色会多出一个「感知判定」步骤', async () => {
    const { result, calls } = await runOnce({
      perceived: [{ text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 }],
      note: '',
    })

    const stages = Object.values(result.steps).map((step) => step.stage)
    expect(stages).toContain('perceive')
    expect(stages).toContain('context')
    expect(calls.some((label) => label.startsWith('perceive:'))).toBe(true)

    const contextStep = Object.values(result.steps).find((step) => step.stage === 'context')!
    const perceiveStep = Object.values(result.steps).find((step) => step.stage === 'perceive')!
    expect(contextStep.deps).toContain(perceiveStep.id)
  })

  it('完全没有超常感官的角色不会多花这一次调用', async () => {
    const { result, calls } = await runOnce(
      { perceived: [], note: '' },
      '',
      [],
    )

    const stages = Object.values(result.steps).map((step) => step.stage)
    expect(stages).not.toContain('perceive')
    expect(calls.some((label) => label.startsWith('perceive:'))).toBe(false)
  })

  it('判定结果进上下文，扮演发出去的提示词里也只有它', async () => {
    const { client } = scriptedClient({
      perceived: [{ text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 }],
      note: '',
    })
    let roleplayPrompt = ''

    const capturing = {
      settings: client.settings,
      isConfigured: true,
      chat: client.chat,
      chatJson: async (messages: { content: string }[], options: ChatJsonOptions) => {
        if ((options.label ?? '').startsWith('roleplay:')) {
          roleplayPrompt = messages.map((message) => message.content).join('\n')
        }
        return client.chatJson(messages as never, options)
      },
    } as unknown as LlmClient

    const round = makeRound()
    const result = await runFullRound({
      client: capturing,
      project: TEST_PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    const bundle = Object.values(result.steps).find((step) => step.stage === 'context')?.output as ContextBundle
    expect(bundle.extras).toHaveLength(1)
    expect(bundle.extras[0].text).toBe('背后有一声很轻的摩擦')

    expect(roleplayPrompt).toContain('背后有一声很轻的摩擦')
    // 他察觉到的是「摩擦声」，不是「右手动了一下」这个原文
    expect(roleplayPrompt).not.toContain('右手在身侧动了一下')
  })

  it('判定为空时，扮演环节就真的什么都没多察觉到', async () => {
    const { result } = await runOnce({ perceived: [], note: '什么都没多察觉到。' })

    const bundle = Object.values(result.steps).find((step) => step.stage === 'context')?.output as ContextBundle
    expect(bundle.extras).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
  })
})

/* ------------------------- 能力与钩子 ------------------------- */

describe('能力与感知会进角色提示词', () => {
  it('能力列进「你能做的事」，并说明超出范围就做不到', () => {
    const withAbilities = card({
      name: '林砚',
      persona: {
        ...card({ name: 'x' }).persona,
        abilities: ['会开锁', '认得草药'],
        perception: ['闻得出三天前留下的气味'],
      },
    })

    const bundle = buildContextBundle({
      card: withAbilities,
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
})
