import { runFullRound } from '@/engine/pipeline'
import type { ChatJsonOptions, LlmClient } from '@/engine/llm/client'
import type { WorkspaceSnapshot } from '@/store/appStore'
import { DEFAULT_LLM_SETTINGS, type ProjectSettings } from '@/types/settings'
import type { Round, Session } from '@/types/step'
import { nowIso } from '@/utils/time'
import { DEMO_PC_PERSONA, ROUND1_INPUT, ROUND1_SCRIPT, ROUND2_INPUT, ROUND2_SCRIPT } from './script'

/** 一个只会照本宣科的客户端：不联网，按 label 返回预设响应 */
function createScriptedClient(script: Record<string, unknown>): LlmClient {
  return {
    settings: { ...DEFAULT_LLM_SETTINGS, baseUrl: 'demo', model: 'demo-script' },
    isConfigured: true,
    chat: async () => {
      throw new Error('演示模式不走流式对话')
    },
    chatJson: async (_messages: unknown, options: ChatJsonOptions) => {
      const label = options.label ?? ''
      const raw = script[label]
      if (raw === undefined) throw new Error(`演示脚本缺少「${label}」的预设响应`)
      return {
        data: options.parse(raw),
        result: {
          content: JSON.stringify(raw),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'demo-script',
          ms: 0,
          retries: 0,
        },
      }
    },
  } as unknown as LlmClient
}

export function demoProject(): ProjectSettings {
  return {
    pcName: '我',
    pcPersona: DEMO_PC_PERSONA,
    storyTitle: '城南茶馆',
    freedomLevel: 'medium',
    interludeFill: true,
    researchEnabled: false,
    misreadLevel: 'medium',
  }
}

/**
 * 生成演示工作区。
 *
 * 注意这里是**真的跑了一遍完整流水线**（用脚本化的模型响应），
 * 所以拆解、上下文包、记忆、编排出来的东西全都是真实产物 ——
 * 截图里的内容不是摆拍。
 */
export async function seedDemoWorkspace(): Promise<{ snapshot: WorkspaceSnapshot; project: ProjectSettings }> {
  const project = demoProject()
  const timestamp = nowIso()
  const session: Session = {
    id: 'demo-session',
    title: '城南茶馆',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const round1: Round = {
    id: 'demo-r1',
    sessionId: session.id,
    index: 1,
    userInput: ROUND1_INPUT,
    stepIds: [],
    rootStepIds: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const round2: Round = { ...round1, id: 'demo-r2', index: 2, userInput: ROUND2_INPUT }
  const rounds = [round1, round2]

  const first = await runFullRound({
    client: createScriptedClient(ROUND1_SCRIPT),
    project,
    round: round1,
    rounds,
    steps: {},
    ledger: [],
  })

  const second = await runFullRound({
    client: createScriptedClient(ROUND2_SCRIPT),
    project,
    round: round2,
    rounds,
    steps: first.steps,
    ledger: first.ledger,
  })

  return {
    snapshot: { sessions: [session], rounds, steps: second.steps, ledger: second.ledger },
    project,
  }
}
