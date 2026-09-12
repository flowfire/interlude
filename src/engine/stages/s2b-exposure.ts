import type { LlmClient } from '@/engine/llm/client'
import type { ChatResult } from '@/types/llm'
import {
  RawExposureSchema,
  type CueChannel,
  type PcCue,
  type PcExposure,
  type RawExposure,
} from '@/types/exposure'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import type { ProjectSettings } from '@/types/settings'
import { makeId } from '@/utils/id'
import { clamp } from '@/utils/time'
import { buildExposureMessages } from '../prompts/exposure'

const CHANNELS: CueChannel[] = ['face', 'voice', 'body', 'pause', 'gaze', 'posture', 'object', 'breath']

export interface ExposureStageInput {
  segments: Segment[]
  sceneSetup: SceneSetup
  project: ProjectSettings
}

/**
 * 找出属于视角角色的内心片段。
 * 规则降级时 subject 可能为空，那种情况默认算在他头上（素材通常以他为主视角）。
 */
export function findPcInnerLines(segments: Segment[], pcName: string): string[] {
  return segments
    .filter((segment) => segment.kind === 'inner')
    .filter((segment) => {
      const subject = segment.subject ?? []
      if (!subject.length) return true
      return subject.includes(pcName)
    })
    .map((segment) => segment.text.trim())
    .filter(Boolean)
}

/** 最多留 3 条，宁精不滥 */
export function normalizeExposure(raw: RawExposure): PcCue[] {
  const cues: PcCue[] = []

  for (const item of raw.cues ?? []) {
    const visible = String(item.visible ?? '').trim()
    if (!visible) continue

    const channelRaw = String(item.channel ?? '').trim().toLowerCase()
    const channel = (CHANNELS.includes(channelRaw as CueChannel) ? channelRaw : 'body') as CueChannel

    const fromIndexRaw = Number(item.fromIndex)
    const fromIndex = Number.isFinite(fromIndexRaw) && fromIndexRaw >= 0 ? Math.floor(fromIndexRaw) : 0

    cues.push({
      id: makeId('cue'),
      hidden: String(item.hidden ?? '').trim(),
      visible,
      channel,
      leakage: clamp(Number(item.leakage ?? 0.5), 0, 1),
      readability: clamp(Number(item.readability ?? 0.4), 0, 1),
      fromIndex,
    })

    if (cues.length >= 3) break
  }

  return cues
}

/**
 * S2b：把你的内心外化成别人看得见的表现。
 *
 * 素材里没有内心活动时直接跳过（不调模型）——没有内心就没有需要外化的东西。
 */
export async function runExposureStage(
  client: LlmClient,
  input: ExposureStageInput,
): Promise<{ output: PcExposure; result: ChatResult | null }> {
  const { segments, sceneSetup, project } = input
  const innerLines = findPcInnerLines(segments, project.pcName)

  if (!innerLines.length) {
    return {
      output: { cues: [], note: '这一轮你没有写内心活动。', hadInner: false, usedModel: false },
      result: null,
    }
  }

  const presentNames = [project.pcName, ...sceneSetup.present.map((item) => item.name)]

  const messages = buildExposureMessages({
    pcName: project.pcName,
    pcPersona: project.pcPersona,
    innerLines,
    sceneSetup,
    presentNames,
    storyTitle: project.storyTitle,
  })

  try {
    const { data, result } = await client.chatJson<RawExposure>(messages, {
      // 外化需要一点观察力，但不需要太多发挥
      temperature: Math.min(client.settings.temperatureCreative, 0.7),
      json: true,
      label: 'exposure',
      parse: (raw) => RawExposureSchema.parse(raw),
    })

    const cues = normalizeExposure(data)
    const note = String(data.note ?? '').trim() || (cues.length ? '' : '他一点都没露。')

    return {
      output: { cues, note, hadInner: true, usedModel: true },
      result,
    }
  } catch (error) {
    return {
      output: {
        cues: [],
        note: '（模型不可用，无法推断你的外在表现）',
        hadInner: true,
        usedModel: false,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
      result: null,
    }
  }
}
