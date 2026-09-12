import type { ChatMessage } from '@/types/llm'
import type { KnownCastEntry } from '@/types/character'
import type { NormalizedDoc } from '../stages/s0-normalize'
import type { Segment } from '@/types/segment'
import type { ContentRating } from '@/types/step'
import { renderKnownCast, renderRecap } from './segmenter'

export interface ScenePromptInput {
  doc: NormalizedDoc
  segments: Segment[]
  pcName: string
  pcPersona: string
  storyTitle: string
  previousScene?: { place: string; situation: string; summary: string } | null
  /** 这一轮的分级，由用户在发送时单独选择 */
  rating?: ContentRating
  /** 这个故事里已经出场过的人，用来解析指代词 */
  knownCast?: KnownCastEntry[]
  /** 前面已经演过的剧情 —— 判断「前面那个人」是谁的主要依据 */
  previousRecap?: string
  /** 时间跳跃时是否自动补全这段时间 */
  interludeFill?: boolean
}

const SYSTEM = `你是「幕间」的场景构建器。用户会给你一段剧情素材以及它的拆解结果，你要把这段素材变成**一个可以立刻开演的场面**。

【先判断用户写的是哪一种】
- "dialogue"：素材里已经有实际演出的内容（有人说话、有具体动作、有明确场景）
- "outline"：素材只是一句概括，比如「我遇到了金刚狼」「三天后我们打了一架」「我去找师父」
- "mixed"：两者都有

【情况 outline：把它展开成场面】
概要只给了你一个骨架，你要补出可以开演的血肉：
1. 时间、地点、氛围：按世界观和上一幕合理推演
2. situation：一句话说清「此刻正在发生什么」
3. opening：2~4 句具体的环境描写，像电影的第一个镜头，要能让人立刻"看见"这个场面
4. present：把概要里提到的人**全部算作在场**。「我遇到了金刚狼」意味着金刚狼就在场，即使素材里他一句话都没说。这是最重要的一条规则。
5. 允许你补 0~2 个路人（kind = "extra"），让场面活起来，但不要喧宾夺主

【情况 dialogue：只补舞台，不改内容】
- 素材里的台词和动作**一字不要改**
- 补齐时间、地点、氛围
- opening 可以写得更完整，但必须与素材一致，不要凭空加戏

${'__INTERLUDE__'}

【硬性规则】
1. 用户明确提到的人一律进 present，哪怕素材里只是「遇到了」「看见」「走向」。
   绝对不要因为"没有台词"就判定他不出场。
2. present 里区分两种：
   - kind = "character"：要建卡、要单独生成反应的正式角色。主要人物一律是 character。
   - kind = "extra"：只有一两句词的临时路人。
   active 字段表示要不要单独生成反应；主要人物一律 active = true。
3. pcProfile：归纳「__PC_NAME__」（用户扮演的角色）**此刻呈现给别人的样子**——
   性别年龄感、穿着、状态、姿态、态度，以及别人第一眼会注意到什么。
   只写"看得见"的，**不要编造他的内心想法**。
4. establishedBeats：素材里已经明确发生的事，按顺序列出。
   __PC_NAME__ 说的话要**原样抄录**，一个字都不要改。
   如果用户只是写了概要、没有具体演出，这个数组可以为空。
5. 不要在 opening 里替任何人说话，也不要写任何人的心理活动。

【输出格式】
{
  "inputMode": "outline",
  "interlude": {
    "summary": "这段时间里场面/世界上发生了什么（一句话，所有人都知道）",
    "each": [
      { "who": "在场某个人的名字", "what": "他在这段时间里做了什么、状态变成什么样" }
    ]
  },
  "time": "三天后的傍晚",
  "place": "城郊废弃的汽车旅馆门口",
  "atmosphere": "雨刚停，路灯坏了一半",
  "situation": "你推门出来，正好和蹲在台阶上擦爪子的人打了个照面。",
  "opening": [
    "雨刚停，柏油路面上积着一层薄水，把歪掉的霓虹招牌映成模糊的一片红。",
    "旅馆门口只有一盏灯还亮着，灯下的台阶上坐着一个人，正低着头擦什么东西。"
  ],
  "pcProfile": "二十出头，外套肩膀湿了一片，站在门口没动，手还搭在门把上——看起来不像常来这种地方的人。",
  "present": [
    { "name": "金刚狼", "role": "坐在台阶上的人", "brief": "正低头擦爪子，已经注意到了你", "kind": "character", "active": true },
    { "name": "前台老头", "role": "旅馆前台", "brief": "隔着玻璃打瞌睡", "kind": "extra", "active": false }
  ],
  "establishedBeats": [
    { "kind": "action", "character": "__PC_NAME__", "text": "推门出来，站在台阶上" }
  ]
}

只输出这一个 JSON 对象，不要解释文字，不要 Markdown 围栏。`

export function buildSceneMessages(input: ScenePromptInput): ChatMessage[] {
  const {
    doc,
    segments,
    pcName,
    pcPersona,
    storyTitle,
    previousScene,
    rating = 'general',
    knownCast,
    previousRecap,
    interludeFill = true,
  } = input

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

  const personaLine = pcPersona.trim()
    ? `【用户填写的自我人设 —— 这是权威设定】\n${pcPersona.trim()}`
    : '【用户没有填写自我人设】请从素材里推断。'

  const previous = previousScene
    ? `【上一幕的结尾】\n地点：${previousScene.place}\n情境：${previousScene.situation}`
    : '【这是第一幕】'

  const ratingLine =
    rating === 'r18'
      ? '\n【本轮分级：成人向】氛围可以更私密、更暧昧（光线、距离、体温、沉默的质感），但**不要为了营造气氛而改变人物的处境或关系**。场面该是几个人还是几个人，该在哪里还是在哪里。\n'
      : ''

  // 只有名单里确实有人带着「会牵引」的设定时才提这一句；
  // 否则等于在暗示模型「去找点麻烦」，没有钩子的故事会被硬塞事件。
  const hasHooks = (knownCast ?? []).some((entry) => entry.hooks?.length)
  const hookGuide = hasHooks
    ? `
【关于「会牵引」—— 让设定自己长出来】
上面有人写了会引发麻烦或事件的体质 / 宿命 / 身份。如果这一轮合适，
可以让场面里**自然地**出现这类东西（一个不怀好意的路人、一段突然的广播、一件不合时宜的旧物）。
但不要硬塞，也不要让它喧宾夺主 —— 它只是背景里的一点征兆。
`
    : ''

  const user = `故事：《${storyTitle}》
视角角色（用户扮演）：「${pcName}」

${personaLine}

${previous}

${renderRecap(previousRecap)}

${renderKnownCast(knownCast)}

【原文】
${doc.text}

【拆解结果】
${segmentLines}
${ratingLine}
【关于指代词 —— 很容易出错的地方】
素材里如果出现「前面那个人」「他」「那家伙」这类说法，先对照上面的「已经出场过的人」判断它指谁，
然后在 present 里**写那个人的真名**。
绝对不要把「前面的人」这种称呼当成一个新角色列进 present —— 那会凭空多出一个人设。
${hookGuide}
请判断用户写的是具体演出还是概要，并输出这一轮的场面设定。`

  const interludeGuide = interludeFill
    ? `【如果素材里有时间跳跃：把空白补上】
素材里可能出现「三天后」「第二天早上」「一个月过去了」这类说法。
主角不在场的这段时间**不是冻结的** —— 别人照样在过日子。
如果你判断这一轮确实有时间跳跃，就在 interlude 里补上这段时间：
· summary：一句话说清这段时间里场面变成什么样了（所有人都看得见的那部分）
· each：这段时间里在场的每个人各自做了什么。一个人一条，只写他这条
  别人看不见的部分也可以写（他这段时间是自己过的）。
· 补全要**顺着已有的设定和关系**走，不要凭空加新角色、新事件、新矛盾 ——
  你填的是"他们照常过日子"的那一层，不是新开一条剧情线。
· 如果这一轮素材里没有时间跳跃，interlude 留空。`
    : `这一轮不要补全任何时间跳跃期间的事，interlude 留空。`

  return [
    { role: 'system', content: SYSTEM.replaceAll('__PC_NAME__', pcName).replaceAll('__INTERLUDE__', interludeGuide) },
    { role: 'user', content: user },
  ]
}
