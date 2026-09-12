import { describe, expect, it } from 'vitest'
import { rerunFrom, runFullRound } from '@/engine/pipeline'
import { getCastLibrary, getMemories, recallFor } from '@/engine/memory/library'
import type { LlmClient } from '@/engine/llm/client'
import type { ChatJsonOptions } from '@/engine/llm/client'
import type { ContextBundle } from '@/types/character'
import type { CastStageOutput } from '@/engine/stages/s3-cast'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/** 测试里关掉联网查资料，否则每个用例都会真的去请求维基百科并等超时 */
const TEST_PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

interface FakeScript {
  segment: unknown
  scene: unknown
  cast: unknown
  roleplay: unknown
}

/** 一个按 label 返回预设结果的假客户端，同时记录每个阶段的调用次数 */
function fakeClient(script: FakeScript) {
  const calls: Record<string, number> = { segment: 0, scene: 0, cast: 0, roleplay: 0 }

  const client = {
    settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
    isConfigured: true,
    chat: async () => {
      throw new Error('未使用')
    },
    chatJson: async (_messages: unknown, options: ChatJsonOptions) => {
      const label = options.label ?? ''
      const key = label.startsWith('roleplay:') ? 'roleplay' : label
      calls[key] = (calls[key] ?? 0) + 1
      const raw = (script as unknown as Record<string, unknown>)[key]
      if (raw === undefined) throw new Error(`没有为 ${label} 准备响应`)
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

  return { client: client as unknown as LlmClient, calls }
}

const SEGMENT = {
  segments: [
    { blockIndex: 0, kind: 'speech', text: '我说：「你来了。」', speaker: '我', confidence: 0.95 },
    { blockIndex: 1, kind: 'speech', text: '林砚说：「嗯。」', speaker: '林砚', confidence: 0.95 },
  ],
  entities: [],
  timeMarkers: [],
}

const SCENE = {
  inputMode: 'dialogue',
  time: '傍晚',
  place: '城南茶馆',
  atmosphere: '雨刚停',
  opening: ['雨停了，青石板上还积着水洼。'],
  situation: '你推门进来，林砚已经坐在靠里的位置。',
  pcProfile: '二十出头，外套湿了一片。',
  present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
  establishedBeats: [{ kind: 'speech', character: '我', text: '你来了。' }],
}

const CAST = {
  characters: [
    {
      name: '林砚',
      tier: 'major',
      summary: '话少的人',
      drive: '',
      speechStyle: '句子很短',
      temperament: ['克制'],
      habits: ['说话前会顿一下'],
      background: '与「我」有旧交',
      mood: '戒备',
      location: '茶馆',
      appearsInInput: true,
      evidence: '素材里他答了一个字',
    },
  ],
}

const ROLEPLAY = {
  beats: [
    { kind: 'cue', text: '抬眼看了半秒' },
    { kind: 'speech', text: '坐吧。', addressee: ['我'] },
  ],
  inner: '她今天不太一样。',
  mood: '收起了漫不经心',
}

function makeRound(sessionId: string, index: number, userInput: string): Round {
  const timestamp = `2024-01-0${Math.min(index, 9)}T00:00:00.000Z`
  return {
    id: `${sessionId}-r${index}`,
    sessionId,
    index,
    userInput,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const INPUT = '我说：「你来了。」\n林砚说：「嗯。」'

describe('跨轮：角色库与记忆', () => {
  it('第二轮会复用第一轮的角色卡，不再重新生成', async () => {
    const { client, calls } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const round1 = makeRound('s1', 1, INPUT)
    const round2 = makeRound('s1', 2, INPUT)
    const rounds = [round1, round2]

    const first = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round1,
      rounds,
      steps: {},
      ledger: [],
    })
    expect(calls.cast).toBe(1)

    const second = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round2,
      rounds,
      steps: first.steps,
      ledger: first.ledger,
    })

    // 阵容解析只跑过一次：第二轮直接从角色库里复用
    expect(calls.cast).toBe(1)

    const secondCast = Object.values(second.steps).find(
      (step) => step.roundId === round2.id && step.stage === 'cast',
    )
    const output = secondCast?.output as CastStageOutput
    expect(output.reusedCount).toBe(1)
    expect(output.characters.map((card) => card.name)).toEqual(['林砚'])

    const library = getCastLibrary(second.steps, { roundIds: new Set([round1.id, round2.id]) })
    expect(Object.values(library).map((card) => card.name)).toEqual(['林砚'])
  })

  it('第二轮派给角色的上下文里带着第一轮的记忆', async () => {
    const { client } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const round1 = makeRound('s1', 1, INPUT)
    const round2 = makeRound('s1', 2, INPUT)
    const rounds = [round1, round2]
    const ids = new Set([round1.id, round2.id])

    const first = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round1,
      rounds,
      steps: {},
      ledger: [],
    })

    // 第一轮结束后应该写入了记忆
    const memoriesAfterFirst = getMemories(first.steps, { roundIds: ids })
    const linYanId = Object.values(getCastLibrary(first.steps, { roundIds: ids }))[0].id
    const own = memoriesAfterFirst[linYanId]
    expect(own).toHaveLength(1)
    expect(own[0].roundIndex).toBe(1)
    expect(own[0].where).toContain('城南茶馆')
    expect(own[0].summary).toContain('听到')
    expect(own[0].inner).toBe('她今天不太一样。')

    const second = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round2,
      rounds,
      steps: first.steps,
      ledger: first.ledger,
    })

    const secondContext = Object.values(second.steps).find(
      (step) => step.roundId === round2.id && step.stage === 'context',
    )
    const bundle = secondContext?.output as ContextBundle

    expect(bundle.recalled).toHaveLength(1)
    expect(bundle.recalled[0].roundIndex).toBe(1)
    expect(bundle.recalled[0].summary).toContain('听到')
  })

  it('记忆能按角色取出最近几段', async () => {
    const { client } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const allRounds = [1, 2, 3].map((index) => makeRound('s1', index, INPUT))
    const ids = new Set(allRounds.map((round) => round.id))

    let steps = {}
    let ledger: never[] = []
    for (const round of allRounds) {
      const result = await runFullRound({
        client,
        project: TEST_PROJECT,
        round,
        rounds: allRounds,
        steps,
        ledger,
      })
      steps = result.steps
      ledger = result.ledger as never[]
    }

    const memories = getMemories(steps, { roundIds: ids })
    const characterId = Object.values(getCastLibrary(steps, { roundIds: ids }))[0].id
    expect(memories[characterId]).toHaveLength(3)
    expect(memories[characterId].map((entry) => entry.roundIndex)).toEqual([1, 2, 3])
    expect(recallFor(memories, characterId, 2)).toHaveLength(2)
    expect(recallFor(memories, characterId, 2)[1].roundIndex).toBe(3)
  })

  it('重跑某一轮的阵容解析时，不会把自己上一次的卡当成「已有角色」', async () => {
    const { client, calls } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const round1 = makeRound('s1', 1, INPUT)
    const first = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round1,
      rounds: [round1],
      steps: {},
      ledger: [],
    })
    expect(calls.cast).toBe(1)

    const castStep = Object.values(first.steps).find((step) => step.stage === 'cast')!
    await rerunFrom(
      {
        client,
        project: TEST_PROJECT,
        round: round1,
        rounds: [round1],
        steps: first.steps,
        ledger: first.ledger,
      },
      castStep.id,
    )

    // 又调了一次模型 —— 说明它没有再把自己上一版的产出当成角色库命中
    expect(calls.cast).toBe(2)
  })

  it('新开一条对话时，不会继承另一条对话的角色卡与记忆', async () => {
    const { client, calls } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const roundA = makeRound('s1', 1, INPUT)
    const first = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: roundA,
      rounds: [roundA],
      steps: {},
      ledger: [],
    })
    expect(calls.cast).toBe(1)

    // 对话 A 里有林砚的卡和一段记忆
    const aIds = new Set([roundA.id])
    expect(Object.keys(getCastLibrary(first.steps, { roundIds: aIds }))).toHaveLength(1)
    expect(Object.keys(getMemories(first.steps, { roundIds: aIds }))).toHaveLength(1)

    // 完全无关的另一条故事线
    const roundB = makeRound('s2', 1, INPUT)
    const second = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: roundB,
      rounds: [roundA, roundB],
      steps: first.steps,
      ledger: first.ledger,
    })

    // 关键：阵容解析又调了一次模型 —— 说明没有从对话 A 的角色库里认领林砚
    expect(calls.cast).toBe(2)

    const bIds = new Set([roundB.id])
    // 对话 B 的角色库只有它自己这一轮生成的卡
    expect(Object.keys(getCastLibrary(second.steps, { roundIds: bIds }))).toHaveLength(1)

    // 对话 B 的上下文里没有来自对话 A 的记忆
    const bContext = Object.values(second.steps).find(
      (step) => step.roundId === roundB.id && step.stage === 'context',
    )
    expect((bContext?.output as ContextBundle).recalled).toHaveLength(0)

    // 反过来，对话 A 的记忆仍然在
    expect(Object.keys(getMemories(second.steps, { roundIds: aIds }))).toHaveLength(1)
  })

  it('删掉某一轮的记忆回写步骤，那一段记忆就随之消失', async () => {
    const { client } = fakeClient({ segment: SEGMENT, scene: SCENE, cast: CAST, roleplay: ROLEPLAY })

    const round1 = makeRound('s1', 1, INPUT)
    const first = await runFullRound({
      client,
      project: TEST_PROJECT,
      round: round1,
      rounds: [round1],
      steps: {},
      ledger: [],
    })

    const commitStep = Object.values(first.steps).find((step) => step.stage === 'commit')!
    const pruned: typeof first.steps = { ...first.steps }
    delete pruned[commitStep.id]

    expect(Object.keys(getMemories(pruned))).toHaveLength(0)
  })
})
