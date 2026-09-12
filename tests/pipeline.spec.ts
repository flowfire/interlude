import { describe, expect, it } from 'vitest'
import { rerunFrom, runSegmentationPreview } from '@/engine/pipeline'
import type { LlmClient } from '@/engine/llm/client'
import type { Round } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import type { SegmentStageOutput } from '@/engine/stages/s1-segment'
import type { NormalizedDoc } from '@/engine/stages/s0-normalize'

/** 一个永远失败的客户端，用来验证「模型不可用时自动降级到规则预标注」这条路 */
function brokenClient(): LlmClient {
  return {
    settings: { ...DEFAULT_LLM_SETTINGS, baseUrl: '', model: '' },
    isConfigured: false,
    chat: async () => {
      throw new Error('未配置模型')
    },
    chatJson: async () => {
      throw new Error('未配置模型')
    },
  } as unknown as LlmClient
}

const USER_INPUT = `三天后，傍晚。雨刚停，青石板上还积着水洼。
我推门进了城南那家茶馆，袖子湿了半截。
我说：「你来得比我预想的早。」
我心里想，他果然还是不想让我看出什么。`

function makeRound(userInput = USER_INPUT): Round {
  return {
    id: 'r1',
    sessionId: 's1',
    index: 1,
    userInput,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('流水线（模型不可用时）', () => {
  it('拆解预览会产出可用的规则结果，而不是抛错', async () => {
    const result = await runSegmentationPreview({
      client: brokenClient(),
      project: DEFAULT_PROJECT_SETTINGS,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const normalizeStep = result.steps[result.normalizeStepId]
    const segmentStep = result.steps[result.segmentStepId]

    expect(normalizeStep.status).toBe('done')
    expect(segmentStep.status).toBe('done')

    const doc = normalizeStep.output as NormalizedDoc
    expect(doc.blocks.length).toBeGreaterThan(0)
    expect(doc.timeMarkerHits.some((hit) => hit.text.includes('三天后'))).toBe(true)

    const output = segmentStep.output as SegmentStageOutput
    expect(output.usedModel).toBe(false)
    expect(output.fallbackReason).toBeTruthy()
    expect(output.segments.length).toBe(doc.blocks.length)

    // 你扮演角色的台词必须被锁定
    const locked = output.segments.filter((segment) => segment.isFact)
    expect(locked.length).toBeGreaterThan(0)
    expect(locked.every((segment) => segment.kind === 'speech')).toBe(true)
  })

  it('重跑拆解时会连带重算上游，且不受影响的分支会被复用', async () => {
    const first = await runSegmentationPreview({
      client: brokenClient(),
      project: DEFAULT_PROJECT_SETTINGS,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const rerun = await rerunFrom(
      {
        client: brokenClient(),
        project: DEFAULT_PROJECT_SETTINGS,
        round: makeRound(),
        steps: first.steps,
        ledger: first.ledger,
      },
      first.normalizeStepId,
    )

    expect(rerun.toRun).toEqual([first.normalizeStepId, first.segmentStepId])
    expect(rerun.steps[first.segmentStepId].status).toBe('done')
  })

  it('改了输入以后，重跑会用到新的文本', async () => {
    const first = await runSegmentationPreview({
      client: brokenClient(),
      project: DEFAULT_PROJECT_SETTINGS,
      round: makeRound(),
      steps: {},
      ledger: [],
    })

    const rerun = await rerunFrom(
      {
        client: brokenClient(),
        project: DEFAULT_PROJECT_SETTINGS,
        round: makeRound('「这一次只有一句话。」'),
        steps: first.steps,
        ledger: first.ledger,
      },
      first.normalizeStepId,
    )

    const doc = rerun.steps[first.normalizeStepId].output as NormalizedDoc
    expect(doc.text).toContain('这一次只有一句话')
    expect(doc.blocks).toHaveLength(1)
  })
})
