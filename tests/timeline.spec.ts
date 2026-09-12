import { describe, expect, it } from 'vitest'
import { splitIntoBlocks } from '@/engine/stages/s0-normalize'
import { composeScene } from '@/engine/stages/s7-compose'
import type { PcExposure } from '@/types/exposure'
import type { SceneSetup } from '@/types/scene'
import type { Segment, SegmentKind } from '@/types/segment'

function seg(
  id: string,
  kind: SegmentKind,
  text: string,
  start: number,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id,
    kind,
    text,
    isFact: false,
    lockedByUser: false,
    visibility: kind === 'inner' ? 'private' : 'public',
    confidence: 0.9,
    sourceRange: [start, start + text.length],
    origin: 'model',
    ...extra,
  }
}

function bareSetup(): SceneSetup {
  return {
    inputMode: 'dialogue',
    time: '',
    place: '',
    atmosphere: '',
    opening: [],
    situation: '',
    pcProfile: '',
    present: [{ name: '林砚', role: '', brief: '', kind: 'character', active: true }],
    establishedBeats: [],
    usedModel: true,
  }
}

describe('切块：括号会把一句话切开', () => {
  it('「A（B）C」被切成三块', () => {
    const blocks = splitIntoBlocks('我其实。。。。 （我有点犹豫） 也没那么想回家。。。。')
    expect(blocks.map((block) => block.text)).toEqual([
      '我其实。。。。',
      '（我有点犹豫）',
      '也没那么想回家。。。。',
    ])
  })

  it('切出来的每块都能用偏移切回原文', () => {
    const text = '我其实。。。。 （我有点犹豫） 也没那么想回家。。。。'
    for (const block of splitIntoBlocks(text)) {
      expect(text.slice(block.range[0], block.range[1])).toBe(block.text)
    }
  })

  it('没有括号时行为不变', () => {
    const blocks = splitIntoBlocks('雨停了。\n我推门进来。')
    expect(blocks.map((block) => block.text)).toEqual(['雨停了。', '我推门进来。'])
  })
})

describe('编排：一轮之内是依次发生的，不是并列归类', () => {
  it('「说一句 → 犹豫 → 再说一句 → 看他一眼 → 又说一句」保持原顺序', () => {
    const segments: Segment[] = [
      seg('s1', 'speech', '我其实。。。。', 0, { speaker: '我' }),
      seg('s2', 'inner', '（我有点犹豫）', 10, { subject: ['我'] }),
      seg('s3', 'speech', '也没那么想回家。。。。', 20, { speaker: '我' }),
      seg('s4', 'action', '（我看着他）', 35, { subject: ['我'] }),
      seg('s5', 'speech', '我可以。。。。跟你待一会吗。', 45, { speaker: '我' }),
    ]

    const exposure: PcExposure = {
      cues: [
        {
          id: 'cue_1',
          fromIndex: 0,
          hidden: '我有点犹豫',
          visible: '指尖在裤缝上蹭了一下',
          channel: 'body',
          leakage: 0.4,
          readability: 0.3,
        },
      ],
      note: '',
      hadInner: true,
      usedModel: true,
    }

    const scene = composeScene({
      sceneSetup: bareSetup(),
      segments,
      cards: [],
      roleplays: [],
      pcName: '我',
      exposure,
    })

    // 这是最关键的一条断言：顺序必须和用户写的一致
    expect(scene.blocks.map((block) => block.kind)).toEqual([
      'pc-speech',
      'pc-cue',
      'pc-speech',
      'pc-action',
      'pc-speech',
    ])
    expect(scene.blocks.map((block) => block.text)).toEqual([
      '我其实。。。。',
      '指尖在裤缝上蹭了一下',
      '也没那么想回家。。。。',
      '（我看着他）',
      '我可以。。。。跟你待一会吗。',
    ])
  })

  it('外化线索会插回它对应的那一条内心原本的位置', () => {
    const segments: Segment[] = [
      seg('s1', 'speech', '第一句', 0, { speaker: '我' }),
      seg('s2', 'inner', '（有点紧张）', 10, { subject: ['我'] }),
      seg('s3', 'speech', '第二句', 20, { speaker: '我' }),
      seg('s4', 'inner', '（又有点后悔）', 30, { subject: ['我'] }),
      seg('s5', 'speech', '第三句', 40, { speaker: '我' }),
    ]

    const exposure: PcExposure = {
      cues: [
        { id: 'c1', fromIndex: 0, hidden: '有点紧张', visible: '声音顿了一下', channel: 'voice', leakage: 0.5, readability: 0.4 },
        { id: 'c2', fromIndex: 1, hidden: '又有点后悔', visible: '说到一半改了口', channel: 'voice', leakage: 0.5, readability: 0.4 },
      ],
      note: '',
      hadInner: true,
      usedModel: true,
    }

    const scene = composeScene({
      sceneSetup: bareSetup(),
      segments,
      cards: [],
      roleplays: [],
      pcName: '我',
      exposure,
    })

    expect(scene.blocks.map((block) => `${block.kind}:${block.text}`)).toEqual([
      'pc-speech:第一句',
      'pc-cue:声音顿了一下',
      'pc-speech:第二句',
      'pc-cue:说到一半改了口',
      'pc-speech:第三句',
    ])
  })

  it('角色反应排在这一整串之后', () => {
    const segments: Segment[] = [
      seg('s1', 'speech', '我其实。。。。', 0, { speaker: '我' }),
      seg('s2', 'inner', '（我有点犹豫）', 10, { subject: ['我'] }),
      seg('s3', 'speech', '也没那么想回家。。。。', 20, { speaker: '我' }),
    ]

    const scene = composeScene({
      sceneSetup: bareSetup(),
      segments,
      cards: [],
      roleplays: [{ characterId: 'c1', name: '林砚', beats: [{ kind: 'speech', text: '……那就别回去。' }] }],
      pcName: '我',
      exposure: {
        cues: [
          { id: 'c1', fromIndex: 0, hidden: '犹豫', visible: '视线落到了地上', channel: 'gaze', leakage: 0.4, readability: 0.3 },
        ],
        note: '',
        hadInner: true,
        usedModel: true,
      },
    })

    const reactionIndex = scene.blocks.findIndex((block) => block.text === '……那就别回去。')
    const lastMineIndex = scene.blocks.map((block) => block.kind).lastIndexOf('pc-speech')
    expect(reactionIndex).toBeGreaterThan(lastMineIndex)
  })

  it('同一句短台词不会因为去重而消失', () => {
    const segments: Segment[] = [
      seg('s1', 'speech', '嗯。', 0, { speaker: '我' }),
      seg('s2', 'speech', '嗯。', 5, { speaker: '林砚' }),
    ]

    const scene = composeScene({
      sceneSetup: bareSetup(),
      segments,
      cards: [],
      roleplays: [],
      pcName: '我',
    })

    expect(scene.blocks.filter((block) => block.text === '嗯。')).toHaveLength(2)
  })
})
