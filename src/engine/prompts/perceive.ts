import type { ChatMessage } from '@/types/llm'

export interface PerceiveCandidate {
  kind: string
  text: string
}

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
  /** 这一轮实际发生了什么 */
  candidates: PerceiveCandidate[]
}

const SYSTEM = `你是「幕间」的信息分发器。

你的工作只有一件：把「这一轮实际发生了什么」，转化成**每个角色各自接收到的版本**。

同一个场面，不同的人接收到的东西是不一样的：
- 背对着的人看不到你手上的动作
- 注意力在别处的人会漏掉一句话，或者只听见半句
- 普通人注意不到空气里那点气味变化、地板那一声轻响
- 而感官超常的人，可能连你藏在背后的手都察觉得到

【硬性要求】
1. **明面上的东西不算你的活。** 当面对他说的话、他正看着的大动作，引擎会直接给他，
   不要重复写进 perceived。
2. 你只写**各人额外察觉到的**那部分 —— 取决于他的位置、注意力和感官。
3. **返回空数组是非常常见的正确答案。** 大部分角色在大部分时候都不会额外察觉到什么。
   所有人都写满内容，才是判断失败。
4. 给他一个**模糊的感觉**，往往比给精确内容更真实：
     ✓「背后有一声很轻的摩擦」
     ✗「他在你背后比了个手势」
   把握不大的写成猜测的口吻，certainty 给低一点；确信无疑的才给高分。
5. 「没说出口的」这类信息，**只对确实有读取能力的角色开放**，
   别人一律不能给 —— 哪怕他感官再敏锐。
6. 不要把一个人察觉到的东西写进另一个人的条目里。每个人只看得到自己那一份。
7. 引擎给你的名单里有几个人，你就输出几条，一条不少也一条不多。

【通道（channel）】
sight 看到 / hearing 听到 / smell 闻到 / touch 触到 / intuition 说不清来由的直觉 /
mind 直接读到念头（只有该角色确实有读取能力时才用）

【输出格式】
{
  "entries": [
    { "name": "必须与名单完全一致", "perceived": [], "note": "一句话说明他额外察觉到多少" },
    {
      "name": "另一个人的名字",
      "perceived": [{ "text": "他实际察觉到的内容", "channel": "hearing", "certainty": 0.4 }],
      "note": "……"
    }
  ]
}

只输出这一个 JSON 对象，不要解释文字，不要 Markdown 围栏。`

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
    ? candidates.map((item) => `· （${item.kind}）${item.text}`).join('\n')
    : '（这一轮没有值得注意的信息）'

  const user = `视角角色（用户扮演）：「${pcName}」——不需要给他分发，他由用户驱动。

【场上需要分发的人】
${actorLines}

【这一轮实际发生了什么】
${candidateLines}

请把上面这些信息，转化成每个人各自接收到的版本。记住：什么都没多察觉到，是合理的答案。`

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}
