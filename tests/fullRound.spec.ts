import { describe, expect, it } from 'vitest'
import { runFullRound } from '@/engine/pipeline'
import type { LlmClient } from '@/engine/llm/client'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import type { CastStageOutput } from '@/engine/stages/s3-cast'
import type { ContextBundle } from '@/types/character'
import type { ComposedScene } from '@/types/character'

/** 测试里关掉联网查资料，否则每个用例都会真的去请求维基百科并等超时 */
const TEST_PROJECT = { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: false }

/**
 * 一个永远失败的客户端。
 * 用来验证：模型不可用时整条链路不崩，且单个角色的失败不会阻断整轮。
 */
function brokenClient(): LlmClient {
  return {
    settings: { ...DEFAULT_LLM_SETTINGS, baseUrl: '', model: '', maxConcurrency: 4 },
    isConfigured: false,
    chat: async () => {
      throw new Error('未配置模型')
    },
    chatJson: async () => {
      throw new Error('未配置模型')
    },
  } as unknown as LlmClient
}

const USER_INPUT = `三天后，傍晚。雨刚停。
我说：「你来得比我预想的早。」
林砚说：「路上耽搁了。」
我心里想，他果然还是不想让我看出什么。`

function makeRound(): Round {
  return {
    id: 'r1',
    sessionId: 's1',
    index: 1,
    userInput: USER_INPUT,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('整轮流水线', () => {
  it('一键跑完：拆解 → 阵容 → 每角色的上下文与反应 → 编排', async () => {
    const result = await runFullRound({
      client: brokenClient(),
      project: TEST_PROJECT,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const stages = Object.values(result.steps).map((step) => step.stage)
    expect(stages).toContain('normalize')
    expect(stages).toContain('segment')
    expect(stages).toContain('cast')
    expect(stages).toContain('context')
    expect(stages).toContain('roleplay')
    expect(stages).toContain('compose')

    // 每个在场角色一条独立分支
    const contextSteps = Object.values(result.steps).filter((step) => step.stage === 'context')
    const roleplaySteps = Object.values(result.steps).filter((step) => step.stage === 'roleplay')
    expect(contextSteps.length).toBeGreaterThan(0)
    expect(contextSteps.length).toBe(roleplaySteps.length)

    // 上下文是纯本地计算，即使模型不可用也应该成功
    expect(contextSteps.every((step) => step.status === 'done')).toBe(true)

    // 反应会因为模型不可用而失败——但失败被限制在这条分支里
    expect(roleplaySteps.every((step) => step.status === 'error')).toBe(true)

    // 编排仍然完成，你的台词原样保留
    expect(result.composeStepId).toBeTruthy()
    const composeStep = result.steps[result.composeStepId!]
    expect(composeStep.status).toBe('done')

    const scene = composeStep.output as ComposedScene
    expect(scene.blocks.some((block) => block.text.includes('你来得比我预想的早'))).toBe(true)
    expect(scene.blocks.filter((block) => block.locked).length).toBeGreaterThan(0)
  })

  it('阵容解析降级后依然能从素材里认出出场角色', async () => {
    const result = await runFullRound({
      client: brokenClient(),
      project: TEST_PROJECT,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const castStep = Object.values(result.steps).find((step) => step.stage === 'cast')!
    const cast = castStep.output as CastStageOutput
    expect(cast.usedModel).toBe(false)
    expect(cast.characters.map((item) => item.name)).toContain('林砚')
  })

  it('上下文包里不会出现别人的内心', async () => {
    const result = await runFullRound({
      client: brokenClient(),
      project: TEST_PROJECT,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const bundles = Object.values(result.steps)
      .filter((step) => step.stage === 'context')
      .map((step) => step.output as ContextBundle)

    for (const bundle of bundles) {
      const visible = [
        ...bundle.sceneLines,
        ...bundle.heard.map((item) => item.text),
        ...bundle.seen.map((item) => item.text),
        ...bundle.knownFacts,
      ].join('|')
      expect(visible).not.toContain('他果然还是不想让我看出什么')
    }
  })
})
