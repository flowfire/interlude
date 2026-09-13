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
  /** 轮次 id → 图片地址 */
  sceneImages: Record<string, string>
}): string {
  const id = input.stuckRoundId ?? input.firstRoundId
  return (id && input.sceneImages[id]) || ''
}
