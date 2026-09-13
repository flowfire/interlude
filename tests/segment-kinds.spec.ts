import { describe, expect, it } from 'vitest'
import { KIND_ORDER } from '@/ui/SegmentList'
import { SEGMENT_KIND_HINT, SEGMENT_KIND_LABEL, SegmentKindSchema } from '@/types/segment'

/**
 * 拆解的类别表有三处，必须始终对齐：
 * · `SegmentKindSchema` —— 类型的唯一真相
 * · `SEGMENT_KIND_LABEL` / `SEGMENT_KIND_HINT` —— 显示用的名字与说明
 * · `KIND_ORDER` —— 编辑区下拉框里的可选项
 *
 * 后两个是手写的，加类别时很容易漏。`directive` 就漏过一次：
 * 简介里统计得出「指示×1」，点开编辑时下拉框里却没有这一项。
 */
describe('拆解类别表必须三处对齐', () => {
  const all = SegmentKindSchema.options as readonly string[]

  it('每个类别都有标签和说明', () => {
    for (const kind of all) {
      expect(SEGMENT_KIND_LABEL[kind as keyof typeof SEGMENT_KIND_LABEL], `${kind} 缺标签`).toBeTruthy()
      expect(SEGMENT_KIND_HINT[kind as keyof typeof SEGMENT_KIND_HINT], `${kind} 缺说明`).toBeTruthy()
    }
  })

  it('编辑区下拉框里能选到每一个类别', () => {
    for (const kind of all) {
      expect(KIND_ORDER, `下拉框里缺「${kind}」`).toContain(kind as never)
    }
  })

  it('下拉框里没有多余的项', () => {
    for (const kind of KIND_ORDER) {
      expect(all).toContain(kind)
    }
  })
})
