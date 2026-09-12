import type { ChatMessage } from '@/types/llm'

export interface MindReadPromptInput {
  readerName: string
  /** 他的读取能力描述（含强弱与限制） */
  ability: string
  targetName: string
  /** 对方此刻的原始内心活动 */
  innerLines: string[]
  /** 对方这一轮的泄漏程度 0~1，越低越藏得住事 */
  leakage: number
  /** 对方这一轮外在露出的东西，供参考 */
  visibleCues: string[]
}

const SYSTEM = `你是「幕间」的读取判定器。你只做一件事：判断某个角色在此刻**实际读到了多少**。

【为什么需要你单独来做这件事】
引擎手上有对方的原始内心活动，但**不允许**直接交给这个角色 ——
他只能用自己的能力去读，而对方的隐藏程度会影响结果。
你先判定他读到了什么，之后的扮演环节**只会拿到你判定的结果，拿不到原文**。
所以你的判断就是最终结果。

【判断依据】
1. 他能力的强弱与限制（请看下面的「读取能力」，注意里面写的**限制**）
2. 对方藏得有多深（泄漏程度越低越难读）
3. 两者相抵之后的结果

【怎么写 readings】
- **完全读不到** → readings 留空数组。这是很常见、也完全正确的答案。
- **只读到模糊的感觉** → 写他实际感知到的样子，例如「他好像在防备着什么」，
  而**不是**照抄原文。
- **读到片段** → 只写那一片段。
- **完整读到** → 可以贴近原文，但仍要用他理解之后的措辞。

certainty 表示他对自己读到的东西有多大把握（0~1）。
把握低意味着他可能误读 —— 这本身就很有戏，不要一律给高分。

【最重要的一条】
**不要因为拿到了原文就照抄。** 你要真的按能力和隐藏程度打折。
如果按他的人设他本来就该读不到，就老老实实返回空数组 ——
空数组不是失败，是正确的判定。全都读得到才是失败。

【输出格式】
{
  "readings": [
    { "text": "他实际感知到的内容", "certainty": 0.4 }
  ],
  "note": "一句话说明他这一轮读到多少，例如「只捕捉到一点情绪的波动」"
}

只输出这一个 JSON 对象，不要解释文字，不要 Markdown 围栏。`

export function buildMindReadMessages(input: MindReadPromptInput): ChatMessage[] {
  const { readerName, ability, targetName, innerLines, leakage, visibleCues } = input

  const hidden = Math.round((1 - leakage) * 100)

  const user = `【读的人】${readerName}
【他的读取能力】${ability}

【对方】${targetName}
【对方这一轮藏得有多深】约 ${hidden}%（数字越大越藏得住事，${Math.round(leakage * 100)}% 泄漏在外）
${visibleCues.length ? `【对方外在露出的】\n${visibleCues.map((line) => `· ${line}`).join('\n')}\n` : ''}
【对方此刻的原始内心活动】
${innerLines.map((line) => `· ${line}`).join('\n')}

请判断他**实际**读到了什么。记住：读不到、或只读到一点，都是合理的答案。`

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}
