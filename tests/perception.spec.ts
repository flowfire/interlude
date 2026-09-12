import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { buildPerceiveCandidates, runPerceiveStage } from '@/engine/stages/s3b-perceive'
import { normalizeCastResult, stableCharacterId } from '@/engine/stages/s3-cast'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { renderKnownCast } from '@/engine/prompts/segmenter'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type {
  CharacterCard,
  ContextBundle,
  KnownCastEntry,
  PerceiveCandidateRecord,
  PerceptionEntry,
  RawCastResult,
} from '@/types/character'
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
    present: [{ name: '听风者', role: '靠里坐着', brief: '在低头擦爪子', kind: 'character', active: true }],
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
    ...overrides,
  } as CharacterCard
}

const PC_INNER = '他果然还是不想让我看出什么'
const SUPERSENSE = '眼观六路，耳听八方，背后有人靠近也能察觉'
const MIND_READING = '能读到对方此刻具体的念头，但读不到动机和来历'

const CANDIDATES: PerceiveCandidateRecord[] = [
  { ref: 1, kind: 'action', text: '你：绕到他背后', from: '我' },
  { ref: 2, kind: 'speech', text: '你：「你来了。」', from: '我' },
  { ref: 3, kind: 'scene', text: '屋里只有一盏灯' },
]

function bundleWith(
  overrides: {
    card?: CharacterCard
    reception?: Parameters<typeof buildContextBundle>[0]['reception']
    candidates?: PerceiveCandidateRecord[]
  } = {},
) {
  const target = overrides.card ?? card({ name: '听风者' })
  return buildContextBundle({
    card: target,
    segments: [],
    cards: [target],
    pcName: '我',
    sceneSetup: setup(),
    candidates: overrides.candidates ?? CANDIDATES,
    reception: overrides.reception,
  })
}

/* ------------------------- 默认全收到，只报偏差 ------------------------- */

describe('信息分发：默认全收到，只报偏差', () => {
  it('三个数组都是空的时候，他收到全部信息', () => {
    const bundle = bundleWith({ reception: { missed: [], distorted: [], extras: [] } })

    expect(bundle.perceived.map((event) => event.text)).toEqual([
      '绕到他背后',
      '你来了。',
    ])
    // 场景类进 sceneLines
    expect(bundle.sceneLines).toEqual(['屋里只有一盏灯'])
  })

  it('missed 里的那一条他确实收不到', () => {
    const bundle = bundleWith({
      card: card({ name: '听风者', persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] } }),
      reception: { missed: [{ ref: 1, why: '他背对着你' }], distorted: [], extras: [] },
    })

    expect(bundle.perceived.map((event) => event.text)).toEqual(['你来了。'])
  })

  it('distorted 里的那一条用「他实际听成的样子」替换，而不是原文', () => {
    const bundle = bundleWith({
      reception: { missed: [], distorted: [{ ref: 2, as: '他听成了质问' }], extras: [] },
    })

    const speech = bundle.perceived.find((event) => event.kind === 'speech')
    expect(speech?.text).toBe('他听成了质问')
  })

  it('没被点名的信息一律按原文给他 —— 台词不会被转述走样', () => {
    const bundle = bundleWith({ reception: { missed: [], distorted: [], extras: [] } })
    const speech = bundle.perceived.find((event) => event.kind === 'speech')
    expect(speech?.text).toBe('你来了。')
  })

  it('自己的台词与动作会被标成 self，用来提醒他别重复演', () => {
    const self = card({ name: '我' })
    const bundle = buildContextBundle({
      card: self,
      segments: [],
      cards: [self],
      pcName: '我',
      sceneSetup: setup(),
      candidates: [{ ref: 1, kind: 'speech', text: '你：「你来了。」', from: '我' }],
      reception: { missed: [], distorted: [], extras: [] },
    })

    expect(bundle.perceived[0].self).toBe(true)
    expect(bundle.ownPriorLines.join('|')).toContain('你说过')
  })

  it('extra 照旧进 extras，并按通道渲染', () => {
    const bundle = bundleWith({
      card: card({ name: '听风者', persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] } }),
      reception: {
        missed: [],
        distorted: [],
        extras: [{ text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 }],
      },
    })

    expect(bundle.extras).toHaveLength(1)
    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('【你额外察觉到的】')
    expect(user).toContain('听到：背后有一声很轻的摩擦（把握 60%）')
  })
})

/* ------------------------- 候选池与安全约束 ------------------------- */

describe('候选池：编号 + 该不该放进来', () => {
  const baseSegments = [
    segment('s1', 'action', '我绕到他背后', { subject: ['我'] }),
    segment('s2', 'speech', '你来了。', { speaker: '我' }),
    segment('s3', 'inner', PC_INNER, { subject: ['我'] }),
    segment('s4', 'scene', '屋里只有一盏灯'),
  ]

  it('逐条编号，从 1 开始', () => {
    const candidates = buildPerceiveCandidates({
      cards: [card({ name: '听风者', persona: { ...card({ name: 'x' }).persona, perception: [SUPERSENSE] } })],
      segments: baseSegments,
      pcName: '我',
    })

    // 场上没人能读心，所以「没说出口的」那一条不进候选池
    expect(candidates.map((item) => item.ref)).toEqual([1, 2, 3])
    expect(candidates.map((item) => item.kind)).toEqual(['action', 'speech', 'scene'])
  })

  it('没人在场时，内心根本不进候选池 —— 不能因为多了一层分发就把原文发出去', () => {
    const candidates = buildPerceiveCandidates({
      cards: [card({ name: '听风者' })],
      segments: baseSegments,
      pcName: '我',
    })

    expect(candidates.some((item) => item.kind === 'inner')).toBe(false)
  })

  it('场上有能读心的角色时，内心才进候选池', () => {
    const candidates = buildPerceiveCandidates({
      cards: [card({ name: '读心者', mindReading: MIND_READING })],
      segments: baseSegments,
      pcName: '我',
    })

    expect(candidates.some((item) => item.kind === 'inner')).toBe(true)
  })

  it('外化出来的细微表现也进候选池', () => {
    const candidates = buildPerceiveCandidates({
      cards: [card({ name: '听风者' })],
      segments: baseSegments,
      exposure: {
        cues: [
          { id: 'c1', hidden: PC_INNER, visible: '视线落到桌面上', channel: 'gaze', leakage: 0.2, readability: 0.15, fromIndex: 0 },
        ],
        note: '',
        hadInner: true,
        usedModel: true,
      },
      pcName: '我',
    })

    expect(candidates.some((item) => item.kind === 'cue')).toBe(true)
  })
})

/* ------------------------- 集成 ------------------------- */

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

function scriptedClient(perceiveResponse: unknown, mindReading = '') {
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
      const key = label.startsWith('roleplay:') ? 'roleplay' : label

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
          present: [{ name: '听风者', role: '对面', brief: '在低头擦爪子', kind: 'character', active: true }],
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
              perception: [SUPERSENSE],
              mindReading,
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

async function runOnce(perceiveResponse: unknown, mindReading = '') {
  const { client, calls } = scriptedClient(perceiveResponse, mindReading)
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

describe('信息分发是独立的一步，且只调用一次', () => {
  it('无论场上有几个人，信息分发只调用一次', async () => {
    const { result, calls } = await runOnce({
      entries: [{ name: '听风者', missed: [], distorted: [], extras: [], note: '' }],
    })

    expect(calls.filter((label) => label === 'perceive')).toHaveLength(1)
    expect(Object.values(result.steps).filter((step) => step.stage === 'perceive')).toHaveLength(1)
  })

  it('漏看的信息确实不进他的上下文', async () => {
    const { result } = await runOnce({
      entries: [
        {
          name: '听风者',
          missed: [
            { ref: 1, why: '他正低头擦爪子，没看见' },
            { ref: 2, why: '他正低头擦爪子，没看见' },
          ],
          distorted: [],
          extras: [{ text: '背后有一声很轻的摩擦', channel: 'hearing', certainty: 0.6 }],
          note: '',
        },
      ],
    })

    const bundle = Object.values(result.steps).find((step) => step.stage === 'context')?.output as ContextBundle

    // 第 1 条是「我绕到他背后」—— 他漏看了
    expect(bundle.perceived.map((event) => event.text)).not.toContain('你：绕到他背后。')
    expect(bundle.extras[0].text).toBe('背后有一声很轻的摩擦')
  })

  it('场上有人能读心时，读不到的那一位会被引擎强制扣掉内心', async () => {
    const reader = card({ name: '读心者', mindReading: MIND_READING })
    const plain = card({ name: '听风者' })
    const { client } = scriptedClient({ entries: [] }, MIND_READING)

    const { output } = await runPerceiveStage(client, {
      cards: [reader, plain],
      segments: [segment('s1', 'inner', PC_INNER, { subject: ['我'] })],
      pcName: '我',
    })

    // 内心确实进了候选池（因为场上有能读心的人）
    expect(output.candidates.some((item) => item.kind === 'inner')).toBe(true)

    // 读心者不被扣，普通人被引擎强制扣掉 —— 不依赖模型自己报
    const readerEntry = output.entries.find((entry) => entry.name === '读心者')!
    const plainEntry = output.entries.find((entry) => entry.name === '听风者')!
    expect(readerEntry.missed).toHaveLength(0)
    expect(plainEntry.missed.some((item) => item.why.includes('没有读取别人内心的能力'))).toBe(true)
  })

  it('扮演环节真正发出去的提示词里，只有他自己接到的那一份', async () => {
    const { client } = scriptedClient({
      entries: [
        {
          name: '听风者',
          missed: [
            { ref: 1, why: '他正低头擦爪子，没看见' },
            { ref: 2, why: '他正低头擦爪子，没看见' },
          ],
          distorted: [],
          extras: [],
          note: '',
        },
      ],
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
    await runFullRound({
      client: capturing,
      project: TEST_PROJECT,
      round,
      rounds: [round],
      steps: {},
      ledger: [],
    })

    expect(roleplayPrompt).not.toContain('绕到他背后')
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

    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('会开锁')
    expect(user).toContain('认得草药')
    expect(user).toContain('超出这个范围的事，你做不到')
    expect(user).toContain('闻得出三天前留下的气味')
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

/* ------------------------- 转述：每个人看到的是他自己视角 ------------------------- */

describe('人称转述', () => {
  const pcAction: PerceiveCandidateRecord[] = [
    { ref: 1, kind: 'action', text: '你：我抬头看了你一眼。', from: '我' },
    { ref: 2, kind: 'speech', text: '你：「你来得比我预想的早。」', from: '我' },
  ]

  function bundleFor(name: string, rendered?: PerceptionEntry['rendered']) {
    return buildContextBundle({
      card: card({ name }),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
      candidates: pcAction,
      reception: { missed: [], distorted: [], extras: [], rendered },
    })
  }

  it('用户扮演的角色在别人眼里是「他」，不是「我」', () => {
    const bundle = bundleFor('林砚')
    // 不能让他们读到「我：我抬头看了你一眼」—— 那会让他们以为是自己做的
    expect(bundle.perceived[0].from).toBe('他')
    expect(bundle.perceived[1].from).toBe('他')
  })

  it('被看的人看到「他看了我一眼」，旁观的人看到「他看了林砚一眼」', () => {
    const seen = bundleFor('林砚', [{ ref: 1, who: '他', as: '他抬头看了我一眼。' }])
    expect(seen.perceived[0].text).toBe('他抬头看了我一眼。')

    const bystander = bundleFor('阿七', [{ ref: 1, who: '他', as: '他抬头看了林砚一眼。' }])
    expect(bystander.perceived[0].text).toBe('他抬头看了林砚一眼。')
  })

  it('台词只换说话人，内容一个字都不能改', () => {
    // 就算模型硬给台词塞一个 as，引擎也会丢掉它
    const bundle = bundleFor('林砚', [{ ref: 2, who: '他', as: '他问你来得比他想得早。' }])
    expect(bundle.perceived[1].text).toBe('你来得比我预想的早。')
    expect(bundle.perceived[1].from).toBe('他')
  })

  it('用户填了真名就用真名', () => {
    const bundle = buildContextBundle({
      card: card({ name: '林砚' }),
      segments: [],
      cards: [],
      pcName: '沈栖',
      sceneSetup: setup(),
      candidates: [{ ref: 1, kind: 'action', text: '你：我抬头看了你一眼。', from: '沈栖' }],
      reception: { missed: [], distorted: [], extras: [] },
    })
    expect(bundle.perceived[0].from).toBe('沈栖')
  })

  it('分发失败（没有转述）时退回原文 + 第三人称称呼', () => {
    const bundle = buildContextBundle({
      card: card({ name: '林砚' }),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
      candidates: pcAction,
      reception: { missed: [], distorted: [], extras: [] },
    })
    expect(bundle.perceived[0].text).toBe('我抬头看了你一眼。')
    expect(bundle.perceived[0].from).toBe('他')
  })
})
