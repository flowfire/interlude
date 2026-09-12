import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import { ensurePresentHasActors, extractNamesFromSegments } from '@/engine/stages/s2-scene'
import type { LlmClient, ChatJsonOptions } from '@/engine/llm/client'
import type { ScenePresent, SceneSetup } from '@/types/scene'
import type { EntityMention, Segment, SegmentKind } from '@/types/segment'
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

describe('谁在场：不能因为「我没说话」就判定不需要交互', () => {
  it('概要式输入只在实体表里留下人名时，也能把人抓出来', () => {
    const segments = [segment('s1', 'narration', '（我遇到了金刚狼）')]
    const entities: EntityMention[] = [{ mention: '金刚狼', kind: 'person', role: 'present' }]

    // 旧逻辑只看说话人和动作主体，这里两者都没有
    expect(extractNamesFromSegments(segments, '我', [])).toEqual([])
    // 补上实体表之后能抓到
    expect(extractNamesFromSegments(segments, '我', entities)).toEqual(['金刚狼'])
  })

  it('「只是被提到」的人不会被硬拉进在场名单', () => {
    const entities: EntityMention[] = [{ mention: '林砚', kind: 'person', role: 'mentioned' }]
    expect(extractNamesFromSegments([], '我', entities)).toEqual([])
  })

  it('模型说「没人需要反应」时，保险丝会把人补回来', () => {
    const segments = [segment('s1', 'narration', '（我遇到了金刚狼）')]
    const entities: EntityMention[] = [{ mention: '金刚狼', kind: 'person', role: 'present' }]

    const fixed = ensurePresentHasActors([], segments, '我', entities)
    expect(fixed.map((item) => item.name)).toEqual(['金刚狼'])
    expect(fixed[0].active).toBe(true)
    expect(fixed[0].kind).toBe('character')
  })

  it('被标成「只是背景」的角色会被提升为参与者，而不是被丢掉', () => {
    const present: ScenePresent[] = [
      { name: '金刚狼', role: '台阶上', brief: '擦爪子', kind: 'character', active: false },
    ]
    const fixed = ensurePresentHasActors(present, [], '我')
    expect(fixed).toHaveLength(1)
    expect(fixed[0].active).toBe(true)
  })

  it('已经有人需要反应时就不动它', () => {
    const present: ScenePresent[] = [
      { name: '林砚', role: '', brief: '', kind: 'character', active: true },
      { name: '阿七', role: '', brief: '', kind: 'extra', active: false },
    ]
    const fixed = ensurePresentHasActors(present, [], '我')
    expect(fixed).toHaveLength(2)
    expect(fixed[1].active).toBe(false)
  })
})

describe('整轮跑通：不说话也有反应', () => {
  const SEGMENT_RESULT = {
    segments: [
      {
        blockIndex: 0,
        kind: 'narration',
        text: '（我遇到了金刚狼）',
        confidence: 0.7,
        reason: '一句概要，没有具体演出也没有台词',
      },
    ],
    entities: [{ mention: '金刚狼', kind: 'person', role: 'present' }],
    timeMarkers: [],
  }

  // 关键在于：场景构建**漏判**了在场者（present 是空的）
  const SCENE_RESULT = {
    inputMode: 'outline',
    time: '傍晚',
    place: '废弃汽车旅馆门口',
    atmosphere: '雨刚停',
    opening: ['雨刚停，霓虹招牌歪着。'],
    situation: '你和蹲在台阶上的人打了个照面。',
    pcProfile: '站在门口没动。',
    present: [],
    establishedBeats: [],
  }

  function fakeClient() {
    const calls: Record<string, number> = {}
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async (_m: unknown, options: ChatJsonOptions) => {
        const label = options.label ?? ''
        const key = label.startsWith('roleplay:') ? 'roleplay' : label
        calls[key] = (calls[key] ?? 0) + 1

        const table: Record<string, unknown> = {
          segment: SEGMENT_RESULT,
          scene: SCENE_RESULT,
          cast: { characters: [{ name: '金刚狼', tier: 'major', summary: '台阶上的人', appearsInInput: true }] },
          roleplay: { beats: [{ kind: 'speech', text: '……有事？' }], inner: '又一个。' },
        }
        const raw = table[key]
        if (!raw) throw new Error(`没有为 ${label} 准备响应`)
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

  function makeRound(): Round {
    return {
      id: 'r1',
      sessionId: 's1',
      index: 1,
      userInput: '（我遇到了金刚狼）',
      stepIds: [],
      rootStepIds: [],
      status: 'draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
  }

  it('场景构建漏判在场者时，整轮依然会跑出角色反应', async () => {
    const { client, calls } = fakeClient()

    const result = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: makeRound(),
      rounds: [makeRound()],
      steps: {},
      ledger: [],
    })

    // 场景构建确实漏判了（这是测试前提）
    const sceneStep = Object.values(result.steps).find((step) => step.stage === 'scene')!
    const sceneSetup = sceneStep.output as SceneSetup
    expect(SCENE_RESULT.present).toHaveLength(0)

    // 但保险丝把金刚狼补了回来
    expect(sceneSetup.present.map((item) => item.name)).toEqual(['金刚狼'])

    // 于是角色反应真的生成了 —— 不再被判定为「不需要交互」
    expect(calls.roleplay).toBe(1)

    const composeStep = Object.values(result.steps).find((step) => step.stage === 'compose')!
    const scene = composeStep.output as { reactions: { name: string }[] }
    expect(scene.reactions.map((item) => item.name)).toEqual(['金刚狼'])
  })
})
