import { describe, expect, it } from 'vitest'
import { detectSpeaker, normalizeInput, splitIntoBlocks } from '@/engine/stages/s0-normalize'
import { normalizeSegmenterOutput, normalizeKind } from '@/engine/stages/s1-segment'
import type { RawSegmenterResult } from '@/types/segment'

describe('S0 规范化', () => {
  it('按行切块并保留原文偏移', () => {
    const text = '雨停了。\n我推门进来。'
    const blocks = splitIntoBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe('雨停了。')
    expect(blocks[1].range[0]).toBe(text.indexOf('我推门进来'))
    // 用偏移切原文，应该能切回原句
    expect(text.slice(blocks[1].range[0], blocks[1].range[1])).toBe('我推门进来。')
  })

  it('识别引号主导的台词与说话人', () => {
    const doc = normalizeInput('我说：「你来得比我预想的早。」')
    expect(doc.blocks[0].ruleKind).toBe('speech')
    expect(doc.blocks[0].ruleSpeaker).toBe('我')
  })

  it('识别心理活动', () => {
    const doc = normalizeInput('我心里想，他果然还是不想让我看出什么。')
    expect(doc.blocks[0].ruleKind).toBe('inner')
  })

  it('识别动作', () => {
    const doc = normalizeInput('我推门进来，把湿伞靠在门边。')
    expect(doc.blocks[0].ruleKind).toBe('action')
  })

  it('扫出时间标记', () => {
    const doc = normalizeInput('三天后，雨又下起来了。')
    expect(doc.timeMarkerHits.map((hit) => hit.text)).toContain('三天后')
  })

  it('后置说话人也能认出来', () => {
    expect(detectSpeaker('「路上耽搁了。」林砚说道').speaker).toBe('林砚')
  })
})

describe('S1 归一化', () => {
  it('标签别名会被纠正成枚举', () => {
    expect(normalizeKind('台词')).toBe('speech')
    expect(normalizeKind('SCENE')).toBe('scene')
    expect(normalizeKind('乱七八糟')).toBe('unknown')
  })

  it('你扮演角色的台词被自动锁定，别人的不会', () => {
    const doc = normalizeInput('我说：「走吧。」\n林砚说：「好。」')
    const raw = {
      segments: [
        { blockIndex: 0, kind: 'speech', text: '我说：「走吧。」', speaker: '我', confidence: 0.95 },
        { blockIndex: 1, kind: 'speech', text: '林砚说：「好。」', speaker: '林砚', confidence: 0.95 },
      ],
      entities: [],
      timeMarkers: [],
    } as unknown as RawSegmenterResult

    const { segments, entities } = normalizeSegmenterOutput(raw, doc, '我')
    expect(segments[0].isFact).toBe(true)
    expect(segments[1].isFact).toBe(false)
    // 视角角色必须出现在实体表里
    expect(entities.some((entity) => entity.mention === '我' && entity.role === 'pc')).toBe(true)
  })

  it('「我」会被映射成 config 里的 pcName', () => {
    const doc = normalizeInput('我说：「走吧。」')
    const raw = {
      segments: [{ blockIndex: 0, kind: 'speech', text: '我说：「走吧。」', speaker: '我', confidence: 0.9 }],
    } as unknown as RawSegmenterResult

    const { segments } = normalizeSegmenterOutput(raw, doc, '沈栖')
    expect(segments[0].speaker).toBe('沈栖')
    expect(segments[0].isFact).toBe(true)
  })

  it('片段区间能对齐回原文', () => {
    const text = '雨停了。\n我推门进来。'
    const doc = normalizeInput(text)
    const raw = {
      segments: [{ blockIndex: 1, kind: 'action', text: '我推门进来。', subject: ['我'], confidence: 0.8 }],
    } as unknown as RawSegmenterResult

    const { segments } = normalizeSegmenterOutput(raw, doc, '我')
    expect(text.slice(segments[0].sourceRange[0], segments[0].sourceRange[1])).toBe('我推门进来。')
  })

  it('心理活动默认不外传', () => {
    const doc = normalizeInput('我心里想，他果然还是不想让我看出什么。')
    const raw = {
      segments: [
        { blockIndex: 0, kind: 'inner', text: '我心里想，他果然还是不想让我看出什么。', subject: ['我'], confidence: 0.8 },
      ],
    } as unknown as RawSegmenterResult

    const { segments } = normalizeSegmenterOutput(raw, doc, '我')
    expect(segments[0].visibility).toBe('private')
  })
})
