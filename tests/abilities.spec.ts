import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { renderKnownCast } from '@/engine/prompts/segmenter'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { CharacterCard, ContextBundle, KnownCastEntry, MindReadOutcome, RawCastResult } from '@/types/character'
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
    present: [{ name: '读心者', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
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

/* ------------------------- 单元：上下文只装判定结果 ------------------------- */

describe('上下文里装的是判定结果，不是原文', () => {
  it('没有读取能力的角色，你的内心依然不外传', () => {
    const plain = card({ name: '林砚' })
    const bundle = buildContextBundle({
      card: plain,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [plain],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(bundle.mindRead).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
    expect(bundle.doesNotKnow.join('|')).toContain('心里在想什么')
  })

  it('有读取能力的角色，拿到的只有判定结果 —— 原文一个字都不在', () => {
    const reader = card({ name: '读心者', mindReading: READER_ABILITY })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
      mindRead: [{ text: '他好像在防备着什么', certainty: 0.4 }],
    })

    expect(bundle.mindRead).toHaveLength(1)
    expect(bundle.mindRead[0].text).toBe('他好像在防备着什么')
    // 最要紧的一条：原始内心根本没进上下文
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
    expect(bundle.doesNotKnow.join('|')).toContain('来历')
  })

  it('判定说「什么都没读到」时，上下文里就是空的', () => {
    const reader = card({ name: '读心者', mindReading: READER_ABILITY })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
      mindRead: [],
    })

    expect(bundle.mindRead).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
  })

  it('扮演提示词里只说「你读到的」，并且不再出现原始内心', () => {
    const reader = card({ name: '读心者', mindReading: READER_ABILITY })
    const bundle = buildContextBundle({
      card: reader,
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      cards: [reader],
      pcName: '我',
      sceneSetup: setup(),
      mindRead: [{ text: '他好像在防备着什么', certainty: 0.4 }],
    })

    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('【你读到的】')
    expect(user).toContain('他好像在防备着什么')
    expect(user).toContain('把握只有 40%')
    expect(user).not.toContain(PC_INNER)
  })
})

/* ------------------------- 集成：读取判定是独立的一步 ------------------------- */

const ROUND_INPUT = '我低下头。（他果然还是不想让我看出什么）'

function makeRound(): Round {
  return {
    id: 'r1',
    sessionId: 's1',
    index: 1,
    userInput: ROUND_INPUT,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function scriptedClient(mindReadResponse: unknown) {
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
      const key = label.startsWith('roleplay:') ? 'roleplay' : label.startsWith('mindread:') ? 'mindread' : label

      const table: Record<string, unknown> = {
        segment: {
          segments: [
            { blockIndex: 0, kind: 'action', text: '我低下头。', subject: ['我'] },
            { blockIndex: 1, kind: 'inner', text: PC_INNER, subject: ['我'], visibility: 'private' },
          ],
          entities: [{ mention: '读心者', kind: 'person', role: 'present' }],
        },
        scene: {
          inputMode: 'dialogue',
          time: '傍晚',
          place: '城南茶馆',
          atmosphere: '',
          opening: [],
          situation: '你低下头',
          pcProfile: '外套湿了一片',
          present: [{ name: '读心者', role: '对面', brief: '在喝茶', kind: 'character', active: true }],
          establishedBeats: [],
        },
        exposure: {
          cues: [
            { fromIndex: 0, hidden: PC_INNER, visible: '视线落到桌面上', channel: 'gaze', leakage: 0.15, readability: 0.1 },
          ],
          note: '',
        },
        cast: {
          characters: [
            { name: '读心者', tier: 'major', summary: '能读到念头的人', mindReading: READER_ABILITY, appearsInInput: true },
          ],
        },
        mindread: mindReadResponse,
        roleplay: { beats: [{ kind: 'speech', text: '……你在想什么？' }], inner: '他藏得挺深。' },
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

async function runOnce(mindReadResponse: unknown) {
  const { client, calls } = scriptedClient(mindReadResponse)
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

describe('读取判定是独立的一步，扮演环节拿不到原文', () => {
  it('有读取能力的角色会多出一个「读取判定」步骤，并且先于扮演', async () => {
    const { result, calls } = await runOnce({ readings: [{ text: '他好像在防备着什么', certainty: 0.4 }], note: '' })

    const stages = Object.values(result.steps).map((step) => step.stage)
    expect(stages).toContain('mindread')
    expect(stages).toContain('context')
    expect(stages).toContain('roleplay')

    // 判定确实单独调用了一次模型
    expect(calls.some((label) => label.startsWith('mindread:'))).toBe(true)

    // 扮演步骤依赖上下文步骤（而上下文依赖判定步骤）
    const contextStep = Object.values(result.steps).find((step) => step.stage === 'context')!
    const mindReadStep = Object.values(result.steps).find((step) => step.stage === 'mindread')!
    const roleplayStep = Object.values(result.steps).find((step) => step.stage === 'roleplay')!
    expect(contextStep.deps).toContain(mindReadStep.id)
    expect(roleplayStep.deps).toContain(contextStep.id)
  })

  it('扮演用的上下文里只有判定结果，原文彻底不出现', async () => {
    const { result } = await runOnce({ readings: [{ text: '他好像在防备着什么', certainty: 0.4 }], note: '' })

    const contextStep = Object.values(result.steps).find((step) => step.stage === 'context')!
    const bundle = contextStep.output as ContextBundle

    expect(bundle.mindRead).toHaveLength(1)
    expect(bundle.mindRead[0].text).toBe('他好像在防备着什么')
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)
  })

  it('判定结果为空时，扮演环节就真的什么都不知道', async () => {
    const { result } = await runOnce({ readings: [], note: '什么都没读到。' })

    const contextStep = Object.values(result.steps).find((step) => step.stage === 'context')!
    const bundle = contextStep.output as ContextBundle

    expect(bundle.mindRead).toEqual([])
    expect(JSON.stringify(bundle)).not.toContain(PC_INNER)

    const mindReadStep = Object.values(result.steps).find((step) => step.stage === 'mindread')!
    expect((mindReadStep.output as MindReadOutcome).note).toContain('什么都没读到')
  })

  it('扮演环节真正发出去的提示词里也不含原文', async () => {
    const { client } = scriptedClient({ readings: [{ text: '他好像在防备着什么', certainty: 0.4 }], note: '' })
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
    await runFullRound({
      client: capturing,
      project: TEST_PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    expect(roleplayPrompt).toContain('他好像在防备着什么')
    expect(roleplayPrompt).not.toContain(PC_INNER)
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
