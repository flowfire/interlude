import { describe, expect, it } from 'vitest'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import { findPcInnerLines, normalizeExposure, runExposureStage } from '@/engine/stages/s2b-exposure'
import { composeScene } from '@/engine/stages/s7-compose'
import { runFullRound } from '@/engine/pipeline'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { ContextBundle } from '@/types/character'
import type { PcExposure } from '@/types/exposure'
import type { SceneSetup } from '@/types/scene'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import type { Segment } from '@/types/segment'

/** 测试里关掉联网查资料，否则会真的去请求维基百科并等超时 */
const TEST_PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

function segment(id: string, kind: Segment['kind'], text: string, extra: Partial<Segment> = {}): Segment {
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

function setup(overrides: Partial<SceneSetup> = {}): SceneSetup {
  return {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: ['雨停了。'],
    situation: '你推门进来。',
    pcProfile: '二十出头，外套湿了一片。',
    present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
    establishedBeats: [],
    usedModel: true,
    ...overrides,
  }
}

describe('S0：括号里的情绪状态算心理活动', () => {
  it('「（我有一点尴尬）」被识别成心理，并标为不外传', () => {
    const doc = normalizeInput('（我有一点尴尬）')
    expect(doc.blocks[0].ruleKind).toBe('inner')
    expect(doc.blocks[0].ruleNotes.join('')).toContain('情绪状态')
  })

  it('括号里是动作时不误判成心理', () => {
    const doc = normalizeInput('（我推门进去，把伞靠在墙角）')
    expect(doc.blocks[0].ruleKind).not.toBe('inner')
  })
})

describe('S2b：你的外化', () => {
  it('找出属于视角角色的内心', () => {
    const segments = [
      segment('s1', 'inner', '我有一点尴尬', { subject: ['我'] }),
      segment('s2', 'inner', '他其实在犹豫', { subject: ['林砚'] }),
      segment('s3', 'inner', '没有主语的内心'),
      segment('s4', 'speech', '你来了', { speaker: '林砚' }),
    ]
    const lines = findPcInnerLines(segments, '我')
    expect(lines).toContain('我有一点尴尬')
    expect(lines).toContain('没有主语的内心')
    expect(lines).not.toContain('他其实在犹豫')
  })

  it('归一化会夹紧数值、纠正通道、最多留 3 条', () => {
    const cues = normalizeExposure({
      cues: [
        { visible: 'a', channel: '目光', leakage: '0.5', readability: 1.8 },
        { visible: 'b', channel: 'gaze', leakage: -1, readability: 0.3 },
        { visible: 'c', channel: 'xxx' },
        { visible: 'd' },
        { visible: 'e' },
      ],
    })
    expect(cues).toHaveLength(3)
    expect(cues[0].channel).toBe('body')
    expect(cues[0].readability).toBe(1)
    expect(cues[1].leakage).toBe(0)
  })

  it('没有内心活动时不调用模型', async () => {
    let called = 0
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
      chatJson: async () => {
        called += 1
        throw new Error('不该被调用')
      },
    } as unknown as LlmClient

    const { output } = await runExposureStage(client, {
      segments: [segment('s1', 'speech', '你来了', { speaker: '我' })],
      sceneSetup: setup(),
      project: DEFAULT_PROJECT_SETTINGS,
    })

    expect(called).toBe(0)
    expect(output.hadInner).toBe(false)
    expect(output.cues).toHaveLength(0)
  })

  it('情绪在别人眼里只留下现象，不留解释', async () => {
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
      chatJson: async (_m: unknown, options: ChatJsonOptions) => {
        const raw = {
          cues: [{ hidden: '我有一点尴尬', visible: '目光挪开了半秒', channel: 'gaze', leakage: 0.4, readability: 0.3 }],
          note: '他维持着平常的样子。',
        }
        return {
          data: options.parse(raw),
          result: {
            content: '{}',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: 'fake',
            ms: 1,
            retries: 0,
          },
        }
      },
    } as unknown as LlmClient

    const { output } = await runExposureStage(client, {
      segments: [segment('s1', 'inner', '我有一点尴尬', { subject: ['我'] })],
      sceneSetup: setup(),
      project: DEFAULT_PROJECT_SETTINGS,
    })

    expect(output.cues).toHaveLength(1)
    expect(output.cues[0].visible).toBe('目光挪开了半秒')
    // 真实内心只留在引擎侧（给用户看），不会跟着出门
    expect(output.cues[0].hidden).toBe('我有一点尴尬')
  })
})

describe('S7：你流露出来的会进舞台', () => {
  it('外化线索作为 pc-cue 块插在你之后、角色反应之前', () => {
    const exposure: PcExposure = {
      cues: [
        {
          id: 'cue_1',
          hidden: '我有一点尴尬',
          visible: '目光在你脸上停了不到半秒就挪开了',
          channel: 'gaze',
          leakage: 0.45,
          readability: 0.3,
          fromIndex: 0,
        },
      ],
      note: '',
      hadInner: true,
      usedModel: true,
    }

    const scene = composeScene({
      sceneSetup: setup({ establishedBeats: [{ kind: 'speech', character: '我', text: '你来了' }] }),
      segments: [],
      cards: [],
      roleplays: [{ characterId: 'c1', name: '林砚', beats: [{ kind: 'speech', text: '坐吧。' }] }],
      pcName: '我',
      exposure,
    })

    const cueBlock = scene.blocks.find((block) => block.kind === 'pc-cue')
    expect(cueBlock).toBeTruthy()
    expect(cueBlock!.text).toBe('目光在你脸上停了不到半秒就挪开了')

    const speechBlock = scene.blocks.find((block) => block.kind === 'pc-speech')
    const reactionBlock = scene.blocks.find((block) => block.kind === 'speech' && block.characterName === '林砚')
    expect(cueBlock!.order).toBeGreaterThan(speechBlock!.order)
    expect(cueBlock!.order).toBeLessThan(reactionBlock!.order)
  })
})

describe('整轮集成：内心不外泄，但外在表现会送达', () => {
  const SEGMENT = {
    segments: [
      { blockIndex: 0, kind: 'speech', text: '我说：「你来了。」', speaker: '我', confidence: 0.95 },
      {
        blockIndex: 1,
        kind: 'inner',
        text: '（我有一点尴尬）',
        subject: ['我'],
        confidence: 0.85,
        visibility: 'private',
      },
    ],
    entities: [],
    timeMarkers: [],
  }

  const SCENE = {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: ['雨停了。'],
    situation: '你推门进来，林砚已经坐在靠里的位置。',
    pcProfile: '二十出头，外套湿了一片。',
    present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
    establishedBeats: [{ kind: 'speech', character: '我', text: '你来了' }],
  }

  const EXPOSURE = {
    cues: [
      {
        fromIndex: 0,
        hidden: '我有一点尴尬',
        visible: '目光在林砚脸上停了不到半秒就挪开了',
        channel: 'gaze',
        leakage: 0.45,
        readability: 0.3,
      },
    ],
    note: '他维持着平常的样子。',
  }

  const CAST = {
    characters: [{ name: '林砚', tier: 'major', summary: '话少的人', appearsInInput: true }],
  }

  const ROLEPLAY = {
    beats: [{ kind: 'speech', text: '坐吧。' }],
    inner: '他今天不太一样。',
  }

  function fakeClient() {
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async (_m: unknown, options: ChatJsonOptions) => {
        const label = options.label ?? ''
        const key = label.startsWith('roleplay:') ? 'roleplay' : label
        const table: Record<string, unknown> = {
          segment: SEGMENT,
          scene: SCENE,
          exposure: EXPOSURE,
          cast: CAST,
          roleplay: ROLEPLAY,
        }
        const raw = table[key]
        if (!raw) throw new Error(`没有为 ${label} 准备响应`)
        return {
          data: options.parse(raw),
          result: {
            content: JSON.stringify(raw),
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            model: 'fake',
            ms: 5,
            retries: 0,
          },
        }
      },
    }
    return client as unknown as LlmClient
  }

  function makeRound(): Round {
    return {
      id: 'r1',
      sessionId: 's1',
      index: 1,
      userInput: '我说：「你来了。」\n（我有一点尴尬）',
      stepIds: [],
      rootStepIds: [],
      status: 'draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
  }

  it('角色的上下文里有你的外在表现，但搜不到你的真实内心', async () => {
    const result = await runFullRound({
      client: fakeClient(),
      project: TEST_PROJECT,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const contextSteps = Object.values(result.steps).filter((step) => step.stage === 'context')
    expect(contextSteps).toHaveLength(1)

    const bundle = contextSteps[0].output as ContextBundle
    expect(bundle.pcCues).toHaveLength(1)
    expect(bundle.pcCues[0].visible).toContain('目光')

    // 最要紧的一条：你的真实内心不能出现在派发给角色的上下文里
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('我有一点尴尬')
    expect(serialized).not.toContain('hidden')

    // 但引擎侧完整保留（给用户看的那份）
    const exposureStep = Object.values(result.steps).find((step) => step.stage === 'exposure')!
    const exposure = exposureStep.output as PcExposure
    expect(exposure.cues[0].hidden).toBe('我有一点尴尬')

    // 舞台上也只出现现象
    const composeStep = Object.values(result.steps).find((step) => step.stage === 'compose')!
    const scene = composeStep.output as { blocks: { kind: string; text: string }[] }
    expect(scene.blocks.some((block) => block.kind === 'pc-cue')).toBe(true)
    expect(JSON.stringify(scene.blocks)).not.toContain('我有一点尴尬')
  })
})
