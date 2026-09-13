import { describe, expect, it } from 'vitest'
import { SEGMENT_KIND_HINT, SEGMENT_KIND_LABEL } from '@/types/segment'
import { buildContextBundle } from '@/engine/stages/s4-context'
import type { CharacterCard } from '@/types/character'

/**
 * 元指令（directive）。
 *
 * 用户有时候写的不是演出内容，而是在指挥引擎 ——「让导演安排一场雨」
 * 「希望接下来有人来找我」。这一类：
 * · 必须**原样送到导演**手里（导演看的是原文，天然能看到）；
 * · 绝不能进角色那边 —— 否则角色会把它当成"我知道的设定"。
 */

const card = {
  id: 'c1',
  name: '林砚',
  aliases: [],
  mindReading: '',
  persona: { summary: '', speechStyle: '', background: '', temperament: [], habits: [], drive: '' },
} as unknown as CharacterCard

const sceneSetup = {
  inputMode: 'dialogue',
  time: '',
  place: '',
  atmosphere: '',
  opening: [],
  situation: '',
  pcProfile: '',
  present: [],
  establishedBeats: [],
  usedModel: true,
} as never

describe('元指令', () => {
  it('界面上有它自己的名字 —— 不会和「场外」混为一谈', () => {
    expect(SEGMENT_KIND_LABEL.directive).toBe('指示')
    expect(SEGMENT_KIND_LABEL.offscreen).toBe('场外')
    expect(SEGMENT_KIND_HINT.directive).toContain('只发给导演')
    // 场外是"被提及但没演出的事"，两回事
    expect(SEGMENT_KIND_HINT.offscreen).toContain('发生在别处')
  })

  it('不会进角色的上下文 —— 那是指示，不是他知道的事', () => {
    const bundle = buildContextBundle({
      card,
      segments: [
        { id: 's1', kind: 'directive', text: '让导演安排一场雨', confidence: 1 },
        { id: 's2', kind: 'worldfact', text: '这镇子只有一口井', confidence: 1 },
      ],
      cards: [card],
      pcName: '我',
      sceneSetup,
    } as never)

    const given = JSON.stringify(bundle)
    expect(given).not.toContain('让导演安排一场雨')
    // 对照：设定类照常给
    expect(given).toContain('这镇子只有一口井')
  })
})
