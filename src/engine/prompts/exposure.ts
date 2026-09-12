import type { ChatMessage } from '@/types/llm'
import type { SceneSetup } from '@/types/scene'
import type { ContentRating } from '@/types/step'

export interface ExposurePromptInput {
  pcName: string
  pcPersona: string
  /** 你这一轮写下的内心活动 */
  innerLines: string[]
  sceneSetup: SceneSetup
  presentNames: string[]
  storyTitle: string
  /** 这一轮的分级，由用户在发送时单独选择 */
  rating?: ContentRating
}

const SYSTEM = `你是「幕间」的外化器。

用户扮演的角色「__PC_NAME__」在这一轮里写下了自己的**内心活动**。这些内心**不会**被直接告诉任何人。
你的工作是：结合他的人设，判断这些内心会在他身上留下什么**看得见的痕迹**。

【只写现象，不写解释】
- 可以写：面部表情、眼神、语气、停顿、呼吸、身体姿态、手里的小动作、触碰到的物件、脚步。
- 不可以写：「因为他尴尬」「显然他在掩饰」「这意味着……」——任何解释性的句子都不行。
- 不可以替他说话，也不可以写别人有什么反应。

【泄漏程度必须符合人设】
这是最重要的判断。同样一句「我有一点尴尬」：
- 一个城府很深、习惯控制表情的人 → leakage 0.1~0.3：几乎什么都看不出来，最多是停顿长了半拍。
- 一个藏不住事、情绪写在脸上的人 → leakage 0.7~0.9：耳朵红了、眼神乱飘、说话打结。
- 人设里没有明说的，按常理取中间值（0.4~0.6）。
不要所有人都外化成同一种"微微一愣"。

【允许一点都不露】
如果这个人设就是能完全压住，就返回空的 cues，并在 note 里说明「他一点都没露」。
这比硬编一个表情要好。

【readability 的含义】
别人把这条线索读成你**真实心理**的概率。
- 0.1：别人只会觉得他有点奇怪，完全猜不到是尴尬。
- 0.5：细心的人能猜个大概。
- 0.9：几乎是明示。

【数量】
一条内心可以对应一到两条线索，总共不要超过 3 条。宁精不滥，一条准的比三条套话好。

【fromIndex 很重要】
我给你的内心活动是**按时间顺序编号**的（0、1、2……），它们发生在这一轮的不同时刻。
每条线索必须带 fromIndex，标明它来自第几条内心 —— 引擎会据此把线索插回它原本的时间位置。
不要把所有线索都写在第一条上。

【输出格式】
{
  "cues": [
    {
      "fromIndex": 0,
      "hidden": "我有一点尴尬",
      "visible": "目光在你脸上停了不到半秒就挪开了，端杯子的手换了个握法",
      "channel": "gaze",
      "leakage": 0.45,
      "readability": 0.3
    }
  ],
  "note": "他努力维持着平常的样子，但熟悉他的人也许能看出一点不自在。"
}

channel 取值：face / voice / body / pause / gaze / posture / object / breath。

只输出这一个 JSON 对象，不要解释文字，不要 Markdown 围栏。`

export function buildExposureMessages(input: ExposurePromptInput): ChatMessage[] {
  const { pcName, pcPersona, innerLines, sceneSetup, presentNames, storyTitle, rating = 'general' } = input

  const sceneLines = [
    sceneSetup.time ? `时间：${sceneSetup.time}` : '',
    sceneSetup.place ? `地点：${sceneSetup.place}` : '',
    sceneSetup.atmosphere ? `氛围：${sceneSetup.atmosphere}` : '',
    sceneSetup.situation ? `此刻：${sceneSetup.situation}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const user = `故事：《${storyTitle}》
视角角色：「${pcName}」

【他的人设 —— 判断外化程度的主要依据】
${pcPersona.trim() || '（用户没有填写人设。请按素材里的表现推断，取中间程度）'}

【他此刻的外在形象】
${sceneSetup.pcProfile || '（没有额外描写）'}

【场面】
${sceneLines || '（没有额外说明）'}

【此刻在场的人】
${presentNames.filter((name) => name !== pcName).join('、') || '（只有他自己）'}

【他这一轮写下的内心活动（按时间顺序编号）】
${innerLines.map((line, index) => `[${index}] ${line}`).join('\n')}
${rating === 'r18' ? '\n【本轮分级：成人向】外化线索可以更直白 —— 呼吸、体温、视线停留的位置、更明显的身体信号。但**泄漏程度仍然由人设决定**：藏得住事的人依然是藏得住的，不会因为分级就写在脸上。\n' : ''}
请判断这些内心会在别人眼里留下什么痕迹，每条线索标明来自哪一条（fromIndex）。`

  return [
    { role: 'system', content: SYSTEM.replaceAll('__PC_NAME__', pcName) },
    { role: 'user', content: user },
  ]
}
