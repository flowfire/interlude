/**
 * 界面背景用哪张图。
 *
 * 规则来自用户：
 * - 有卡片的场面条**吸顶** → 用那一轮的图；
 * - **一张都没吸顶** → 说明还停在这一段剧情之前，用**第一张卡片**的图；
 * - 注意是"第一张卡片"，**不是"第一张有图的卡片"** —— 第一张没图就按没有背景处理，
 *   不要回退着往后找。
 *
 * 抽成纯函数是为了让后两条能被测住：它们在实现里看起来像"可以顺手优化掉"的地方。
 */
export function pickBackdrop(input: {
  /** 当前吸顶的那一轮；没有就是 null */
  stuckRoundId: string | null
  /** 当前对话的第一轮 */
  firstRoundId: string
  /** 当前对话的轮次顺序（从早到晚）—— 回溯要找的图时用得上 */
  roundOrder: string[]
  /** 轮次 id → 图片地址 */
  sceneImages: Record<string, string>
}): string {
  if (input.stuckRoundId) {
    // 从吸顶那一轮**往前找最近的一张图**。
    // 场景沿用的轮次自己没有图（用户没在这一轮生过），但它所在的就是同一个
    // 场景，背景该继续用上一张，而不是空掉。
    const index = input.roundOrder.indexOf(input.stuckRoundId)
    for (let i = index; i >= 0; i -= 1) {
      const url = input.sceneImages[input.roundOrder[i]]
      if (url) return url
    }
    return ''
  }

  // 一张卡都没吸顶 = 还停在第一段之前。这里**不回溯**：就用第一张卡片的图，
  // 它没有图就按没有背景处理。（用户明确定过的规则。）
  return input.sceneImages[input.firstRoundId] ?? ''
}
