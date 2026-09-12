import type { ChatMessage } from '@/types/llm'
import type { NormalizedDoc } from '../stages/s0-normalize'
import type { WikiLookup } from '../research/wiki'
import type { Segment } from '@/types/segment'
import type { ScenePresent } from '@/types/scene'

export interface CastPromptInput {
  doc: NormalizedDoc
  segments: Segment[]
  pcName: string
  storyTitle: string
  present: ScenePresent[]
  /** 名字 → 查到的维基资料 */
  research: Record<string, WikiLookup>
}

const SYSTEM = `你是「幕间」的角色卡生成器。场景构建器已经确定了这一轮有哪些人在场，你要为名单上的每一个人写一份角色卡。

【先分类，再写卡】
对名单上每个名字，先判断它属于哪一类，写法完全不同：

■ A 类：我给了「参考资料」
  资料是权威的，不要与之矛盾。基于资料把卡写厚、写具体。

■ B 类：没有资料，但你认识这个名字
  （来自某部小说 / 电影 / 游戏 / 动漫，或者现实中的公众人物）
  用你自己的知识写。**这一类的唯一要求是：具体。**

  绝对不要写这种话 —— 它们放在一百个角色身上都成立，等于没写：
    ✗「沉默寡言，性格坚毅，重情重义」
    ✗「外表冷酷，内心温柔」
    ✗「实力强大，深藏不露」
    ✗「有着复杂的过去」

  要写成这样：
    ✓「不主动搭话，但会用一句带刺的玩笑回应试探」
    ✓「被问到过去时会直接换话题」
    ✓「动手前习惯先活动一下脖子」
    ✓「嘴上嫌麻烦，但答应过的事一定会做到」

  B 类必须填满这四项：
    - signature：至少 3 条标志性特征（行为习惯、说话方式、外观细节），
      要具体到熟悉原作的人一眼就能认出来
    - voiceSamples：2~3 句符合他说话方式的示例台词。可以改写成中文，
      但用词习惯、句长、是否带刺或带玩笑，要像他
    - canonAnchors：原作里确定的事实 —— 关键经历、重要关系、能力**及其限制**
    - boundaries：他绝不会做的事、绝不会说的话。这一项专门用来防止出戏，很重要

■ C 类：你完全不认识这个名字
  多半是原创角色。只根据素材写薄卡，**不要编造身世、秘密、组织、超能力**。
  signature / voiceSamples / canonAnchors 可以为空，但要尽量从素材里挤出具体的东西。

【通用红线】
1. 三类不要混着写：原创角色不要编造宏大设定，知名角色不要写得比素材还空。
2. **不确定的细节宁可不写**，也不要写一个可能是错的「经典设定」。
   写错一个知名角色的关键设定，比写得少更让人出戏。
3. habits / signature 只写**看得见**的，不要写心理活动。
4. 不要把视角角色「__PC_NAME__」写进 characters。
5. name 必须和名单里写的**完全一致**，一个字都不能改。

【输出格式】
{
  "characters": [
    {
      "name": "必须与名单完全一致",
      "aliases": [],
      "tier": "major",
      "canonical": true,
      "franchise": "《作品名》或「现实人物」，原创角色留空",
      "summary": "一句话说清这个人是谁",
      "speechStyle": "说话风格：句长、用词、口头禅、有没有停顿和回避",
      "temperament": ["具体一点，不要四字成语堆砌"],
      "habits": ["看得见的小动作"],
      "signature": ["标志性特征 1", "标志性特征 2", "标志性特征 3"],
      "voiceSamples": ["示例台词一", "示例台词二"],
      "canonAnchors": ["原作里确定的事实"],
      "boundaries": ["他绝不会做的事"],
      "background": "他的处境、与「__PC_NAME__」的关系",
      "mood": "此刻的心境",
      "location": "此刻在哪",
      "appearsInInput": true,
      "evidence": "依据来自素材的哪一句、参考资料，还是你的知识"
    }
  ]
}

tier 取值：major（主要角色）、minor（次要）、extra（只有一两句词的路人）。

只输出这一个 JSON 对象，不要任何解释文字、不要 Markdown 围栏。`

export function buildCastMessages(input: CastPromptInput): ChatMessage[] {
  const { doc, segments, pcName, storyTitle, present, research } = input

  const presentList = present
    .map((item) => {
      const head = `- ${item.name}（${item.kind === 'extra' ? '路人' : '角色'}）位置：${item.role || '未说明'}；此刻：${item.brief || '未说明'}`
      const found = research[item.name]
      if (!found) return `${head}\n  （没有查到外部资料）`
      const langLabel = found.lang === 'zh' ? '中文维基' : '英文维基'
      return `${head}\n  【参考资料 · ${langLabel}「${found.title}」】${found.extract}`
    })
    .join('\n\n')

  const segmentLines = segments
    .map((segment) => {
      const who = segment.speaker
        ? ` 说话人=${segment.speaker}`
        : segment.subject?.length
          ? ` 主体=${segment.subject.join('、')}`
          : ''
      return `- [${segment.kind}${who}] ${segment.text}`
    })
    .join('\n')

  const user = `故事：《${storyTitle}》
视角角色（用户扮演）：「${pcName}」

【必须建卡的名单】
${presentList || '（名单是空的，这时请从素材里自己判断有哪些人在场）'}

【原文】
${doc.text}

【拆解结果】
${segmentLines}

请严格按名单建卡。有参考资料的就依据资料，没有资料但你认识的就把卡写具体，完全不认识的只按素材写薄卡。`

  return [
    { role: 'system', content: SYSTEM.replaceAll('__PC_NAME__', pcName) },
    { role: 'user', content: user },
  ]
}
