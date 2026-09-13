import type { ChatMessage } from '@/types/llm'
import type { KnownCastEntry } from '@/types/character'
import { SEGMENT_KIND_HINT, SEGMENT_KIND_LABEL } from '@/types/segment'
import type { NormalizedDoc } from '../stages/s0-normalize'

const KIND_TABLE = (Object.keys(SEGMENT_KIND_LABEL) as Array<keyof typeof SEGMENT_KIND_LABEL>)
  .map((kind) => `- ${kind}（${SEGMENT_KIND_LABEL[kind]}）：${SEGMENT_KIND_HINT[kind]}`)
  .join('\n')

export interface SegmenterPromptInput {
  doc: NormalizedDoc
  pcName: string
  pcPersona: string
  storyTitle: string
  freedomLevel: 'low' | 'medium' | 'high'
  /** 这个故事里已经出场过的人，用来解析指代词 */
  knownCast?: KnownCastEntry[]
  /** 前面已经演过的剧情 */
  previousRecap?: string
}

/** 渲染「已经出场过的人」名单，给三个需要消歧的阶段共用 */
export function renderKnownCast(knownCast: KnownCastEntry[] | undefined): string {
  if (!knownCast?.length) return '【已经出场过的人】\n（这是第一轮，还没有已知角色）'
  return `【已经出场过的人】\n${knownCast
    .map((entry) => {
      const alias = entry.aliases.length ? `（也叫 ${entry.aliases.join('、')}）` : ''
      const hooks = entry.hooks?.length ? `\n    · 会牵引：${entry.hooks.join('；')}` : ''
      return `- ${entry.name}${alias}：${entry.brief || '（没有更多说明）'}${hooks}`
    })
    .join('\n')}`
}

/**
 * 渲染前文剧情。
 *
 * 这一份比「角色卡名单」重要得多 —— 「前面那个人」指的是谁，
 * 取决于上一幕里谁走在前面、谁站在哪儿，光看名单是看不出来的。
 */
export function renderRecap(recap: string | undefined): string {
  if (!recap?.trim()) return ''
  return (
    `【前面已经演过的内容】\n${recap.trim()}\n\n` +
    '（素材里的「他」「那个人」「前面的人」「那家伙」很可能指的就是这上面出现过的人 —— ' +
    '对照着判断，直接写那个人的名字，不要新造一个角色。）'
  )
}

const SYSTEM = `你是「幕间」的拆解器。你唯一的工作是把用户给的一段剧情素材，拆成带类型标签的最小片段，并标出涉及的实体与时间标记。

【片段类型】
${KIND_TABLE}

【硬性要求】
1. 只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码围栏。
2. 每个片段必须带 blockIndex，指向我给你的文本块编号。
3. 允许把一个文本块拆成多个片段（例如一句话里既有动作又有台词），但每个片段的 text 必须是该块原文里**连续且一字不改**的子串。不要改写、不要润色、不要补标点。
4. speech 必须给出 speaker。原文用「我」自称且指视角角色时，speaker 写「__PC_NAME__」。
5. inner 必须给出 subject（谁的心理活动）。
6. confidence 是你对这条判定的把握，0~1 的小数。
7. 判断顺序：先看是不是"说出口的话"，再看是不是"心里想的"，再看是不是"环境/陈设"，剩下的才是动作与旁白。不要把心理活动混进动作。
8. 场景描写（天气、光线、地点、气味、陈设）一律算 scene，不要算 narration。
9. 提到但并未在本段演出的往事、别处发生的事，算 offscreen，并尽量在 reason 里写清时间。
10. **用户在指挥你（而不是在演出）时，算 directive**：例如「让导演安排一场雨」
    「希望接下来有人来找我」「这一轮别让他们说话」。把他的话原样抄进 text。

    **怎么和演出区分开** —— 看主语是谁在动：
    · 「天开始下雨了」是 scene —— 他在描述世界里发生了什么
    · 「让天下雨」是 directive —— 他在要求引擎做什么
    · 「我希望他别走」是 inner —— 那是他扮演的角色的心理
    · 「让他留下来」是 directive —— 那是指示，不是角色的动作

    directive 只会送到导演手里，角色看不到它 —— 所以放心照抄，不必替它润色。

【关于时间顺序 —— 这一条极其重要】
10. **用户是按时间顺序写的**。输出的 segments 必须保持原文顺序，不要按类型重排。
    同一轮里的台词和动作是**依次发生**的，不是同时发生的。
11. 一段话被括号里的心理或动作打断时，括号前后是**两次独立的发言**，要拆成两段。
    例如：「我其实。。。。」+「（我有点犹豫）」+「也没那么想回家。。。。」
    → speech「我其实。。。。」+ inner「我有点犹豫」+ speech「也没那么想回家。。。。」
    不要把它们合并成一段，也不要因为中间插了括号就把整段都算成心理活动。
12. **不要因为没有引号就判成心理或旁白**。视角角色明显说出口的话（带省略号、语气词、
    被停顿切开、有「我说」「我开口」之类的提示）一律判成 speech。
    心理活动只包括三种：括号里的情绪状态、明确的「心想/暗想/心中」，以及真正没说出口的念头。
13. **素材里出现「他」「那个人」「前面的人」「那家伙」这类指代时**，先结合下面给出的
    【已经出场过的人】判断它指的是谁，然后**直接写那个人的名字**。
    不要把指代词照抄成 speaker 或 subject —— 那会凭空多出一个人设。

【输出格式】
{
  "segments": [
    {
      "blockIndex": 0,
      "kind": "scene",
      "text": "原文的连续子串",
      "speaker": null,
      "addressee": [],
      "subject": [],
      "location": "茶馆门口",
      "confidence": 0.9,
      "visibility": "public",
      "reason": "简短说明为什么这么判"
    }
  ],
  "entities": [
    { "mention": "人物或地点的名字", "kind": "person", "role": "pc" }
  ],
  "timeMarkers": [
    { "text": "三天后", "kind": "elapsed", "value": "P3D" }
  ]
}

entities 的 role 取值：pc（视角角色本人）、present（本段在场）、mentioned（只是被提到）。
timeMarkers 的 kind 取值：absolute（绝对时间）、relative（相对时间）、elapsed（过了一段时间）、unknown。
visibility：只有 inner 用 "private"，其余用 "public"。`

export function buildSegmenterMessages(input: SegmenterPromptInput): ChatMessage[] {
  const { doc, pcName, pcPersona, storyTitle, freedomLevel, knownCast, previousRecap } = input

  const blockLines = doc.blocks
    .map((block) => {
      const guess = block.ruleKind === 'narration' ? '规则层未判定' : `规则层猜测：${SEGMENT_KIND_LABEL[block.ruleKind]}`
      const speakerHint = block.ruleSpeaker ? `，疑似说话人：${block.ruleSpeaker}` : ''
      const notes = block.ruleNotes.length ? `（${block.ruleNotes.join('；')}）` : ''
      return `[${block.index}] ${guess}${speakerHint}${notes}\n${block.text}`
    })
    .join('\n\n')

  const timeHints = doc.timeMarkerHits.length
    ? `\n规则层扫到的时间标记：${doc.timeMarkerHits.map((hit) => `「${hit.text}」`).join('、')}`
    : ''

  const user = `故事：《${storyTitle}》
视角角色（用户扮演）：「${pcName}」。原文里的「我」通常指这个角色，除非上下文明显不是。

【用户填写的自我人设】
${pcPersona.trim() || '（用户没有填写，请从素材里推断）'}

${renderRecap(previousRecap)}

${renderKnownCast(knownCast)}

演绎自由度：${freedomLevel}（只影响后续环节，不影响你的拆解）

下面是素材，已切成编号文本块。请给每一块打标签，需要时把一块拆成多块。
${timeHints}

${blockLines}

请严格按约定输出 JSON。`

  return [
    { role: 'system', content: SYSTEM.replaceAll('__PC_NAME__', pcName) },
    { role: 'user', content: user },
  ]
}
