import type { ChatMessage } from '@/types/llm'
import type { PerceiveCandidateRecord } from '@/types/character'

export interface PerceiveActor {
  name: string
  /** 他此刻在哪、注意力放在哪 */
  position: string
  /** 超出常人的感官 */
  senses: string[]
  /** 读取内心的能力（空表示没有） */
  mindReading: string
}

export interface PerceivePromptInput {
  pcName: string
  actors: PerceiveActor[]
  /** 这一轮实际发生了什么，一条一个编号 */
  candidates: PerceiveCandidateRecord[]
}

const SYSTEM = `你是「幕间」的信息分发器。

你的工作只有一件：把「这一轮实际发生了什么」，转化成**每个角色各自接收到的版本**。

同一个场面，不同的人接收到的东西不一样：
- 背对着的人看不到你手上的动作
- 注意力在别处的人会漏掉一句话，或者只听见半句
- 有人把一句玩笑听成了挑衅（他接收到了，但理解走样了）
- 而感官超常的人，可能连你藏在背后的手都察觉得到

【默认规则 —— 这决定了你要写多少】
**默认每个人都接收到了全部信息。** 你只需要报**偏差**，不用逐个复述：

- missed：他**没接收到**的，写明是哪一条编号、为什么（背对着 / 走神 / 不在场 / 被挡住）
- distorted：他接收到了、但**走了样**的，写明是哪一条编号、他实际听成／看成了什么
- extras：在这些信息**之外**他额外察觉到的（超常感官、读到念头）

大多数角色在大多数时候，三个数组都是空的。**这是最常见的正确答案。**

【硬性要求】
1. 只用编号（ref）引用信息，**不要复述原文**。
2. 「没说出口的」这类信息，**只对确实有读取能力的角色开放**。
   别人即使感官再敏锐也不能收到 —— 如果分发时发现这一条，直接写进 missed。
3. 不要把某个人漏掉的信息写进另一个人的条目里。
4. 引擎给你的名单里有几个人，你就输出几条，一条不少也一条不多。
5. 只有在**确实有理由**的时候才标 missed。没有明确理由（位置、注意力、遮挡）
   就不要扣别人的信息 —— 漏判比多判更伤。

【通道（extra 用）】
sight 看到 / hearing 听到 / smell 闻到 / touch 触到 / intuition 说不清来由的直觉 /
mind 直接读到念头（只有该角色确实有读取能力时才用）

【extra 的写法】
给他一个**模糊的感觉**往往比给精确内容更真实：
  ✓「背后有一声很轻的摩擦」
  ✗「他在你背后比了个手势」
把握不大的写成猜测的口吻，certainty 给低一点。

【转述 —— 每个人看到的是他自己视角的那句话】
候选池里存的是**用户写的第一人称叙述**（「我抬头看了你一眼」）。
同一条信息，不同的人看到的是不同的说法，你要把它转过来：

- 用户（原文里的「我」）在别人眼里是**「他」**。如果名单上有他的名字，直接用名字。
- 原文里的「你」指的是**当事人**：在当事人的版本里是「我」，
  在旁人版本里是那个人的名字。
- **台词一个字都不能改。** 引号里是原话，只换说话人的称呼，内容原样保留。
- 没有人称代词的信息不用转述（「雨下大了」谁看都一样）。

例子 —— 原文「我抬头看了你一眼」，你说给林砚听，阿七也在场：

| 谁 | who | as |
|---|---|---|
| 林砚 | "他" | "抬头看了我一眼。" |
| 阿七 | "他" | "抬头看了林砚一眼。" |

`as` 只管**动作本身**，主语由 who 提供（引擎会拼成「他：抬头看了我一眼」）。

**只在确实需要转述时才给 rendered**，别把每条都抄一遍。

【输出格式】
{
  "entries": [
    {
      "name": "必须与名单完全一致",
      "missed": [{ "ref": 1, "why": "他背对着你，看不见" }],
      "distorted": [{ "ref": 3, "as": "他听成了不耐烦" }],
      "rendered": [{ "ref": 2, "who": "他", "as": "抬头看了我一眼。" }],
      "extras": [{ "text": "背后有一声很轻的摩擦", "channel": "hearing", "certainty": 0.4 }],
      "note": "一句话说明他这一轮的接收情况"
    }
  ]
}

四个数组都可以是空的。只输出这一个 JSON 对象，不要解释文字，不要 Markdown 围栏。`

export function buildPerceiveMessages(input: PerceivePromptInput): ChatMessage[] {
  const { pcName, actors, candidates } = input

  const actorLines = actors
    .map((actor, index) => {
      const senses = actor.senses.length ? actor.senses.join('；') : '普通人'
      const mind = actor.mindReading.trim() ? actor.mindReading.trim() : '无'
      return `${index + 1}. ${actor.name}\n   位置与注意力：${actor.position || '（未说明）'}\n   超常感官：${senses}\n   读取念头的能力：${mind}`
    })
    .join('\n')

  const candidateLines = candidates.length
    ? candidates.map((item) => `[${item.ref}] （${kindLabel(item.kind)}）${item.text}`).join('\n')
    : '（这一轮没有值得分发的信息）'

  const user = `视角角色（用户扮演）：「${pcName}」——不需要给他分发，他由用户驱动。

【场上需要分发的人】
${actorLines}

【这一轮实际发生了什么】
${candidateLines}

请对照每个人的位置、注意力与感官，标出他**接收上的偏差**。
默认所有人都收到了全部信息，所以大多数条目应该三个数组都是空的。`

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}

function kindLabel(kind: PerceiveCandidateRecord['kind']): string {
  switch (kind) {
    case 'speech':
      return '说出口的'
    case 'action':
      return '动作'
    case 'scene':
      return '场景'
    case 'ambient':
      return '氛围'
    case 'cue':
      return '细微表现'
    case 'event':
      return '正在发生的事'
    case 'inner':
      return '没说出口的'
    default:
      return '信息'
  }
}
