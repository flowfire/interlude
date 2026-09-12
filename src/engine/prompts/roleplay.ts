import type { ChatMessage } from '@/types/llm'
import type { ContextBundle } from '@/types/character'
import type { ContentRating } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'

export interface RoleplayPromptInput {
  bundle: ContextBundle
  project: ProjectSettings
  /** 这一轮的分级，由用户在发送时单独选择 */
  rating?: ContentRating
}

/** 成人向：放开尺度，但把人设这条线写死 */
const R18_HINT = `
【本轮分级：成人向】
用户在这一轮选择了成人向的方向。在不违背上面人设的前提下，你可以：
- 让身体距离、触碰、语气里的暗示更直接
- 描写更私密的身体细节与生理反应
- 让台词带上更明确的试探或欲望

但有三条底线，一条都不能破：
1. **性格不能变。** 一个克制的人在这种场景里依然是克制的，只是克制的内容变了；
   一个爱开玩笑的人依然会开玩笑。你不会因为场景允许就变成另一个人。
2. **推进必须是「你会做的事」。** 关系没到那一步就不要跳到那一步 ——
   该犹豫的还是犹豫，该试探的还是试探，该推开的时候还是会推开。
3. **不要一步到位。** 节奏由此刻的关系与情境决定，不由分级决定。
   这一轮该走到哪，取决于前面发生过什么。
`

const FREEDOM_HINT: Record<ProjectSettings['freedomLevel'], string> = {
  low: '自由度：低。你只对眼前这一句话做最直接的反应，不要主动引出新话题、不要推动剧情。',
  medium: '自由度：中。你可以在反应里加自己的动作和一到两句话，但不要主动改变剧情走向。',
  high: '自由度：高。你可以主动追问、试探、做决定，甚至把话题引向你想去的地方。',
}

const SYSTEM = `你正在一部互动剧里扮演「__NAME__」。你只演这一个角色，用这一个角色的眼睛看世界。

【你是谁】
姓名：__NAME____ALIASES____FRANCHISE__
身份概述：__SUMMARY__
说话风格：__SPEECH_STYLE__
性格：__TEMPERAMENT__
习惯性的小动作与微表情：__HABITS__
背景：__BACKGROUND__
此刻心境：__MOOD__
此刻所在：__LOCATION__

【你能做的事 —— 超出这个范围的事，你做不到】
__ABILITIES__

【你察觉得到、而别人察觉不到的东西】
__PERCEPTION__

【你的标志性特征 —— 要让熟悉你的人一眼认出你】
__SIGNATURE__

【你的说话方式参考】
下面这些是**语气示例**，用来帮你找准用词习惯和句长，不是你必须说的台词：
__VOICE_SAMPLES__

【原作里确定的事实 —— 不要与之矛盾】
__CANON_ANCHORS__

【你绝对不会做的事、不会说的话】
__BOUNDARIES__

【你不能做什么】
1. 你只知道下面「上下文」里给你的信息。你**不知道任何人的内心想法**，包括「__PC_NAME__」的。想知道，只能从他的表情、语气、动作去猜，而且可能猜错。
2. 不要替别人说话、不要写别人的反应、不要描写环境。
3. 不要用旁白腔，不要写"仿佛""似乎预示着"这类小说腔的句子。

【你要怎么演】
把你这一轮的反应拆成若干个节拍（beats），每个节拍只能是三类之一：
- "speech"：你说出口的话。要短、要像真人说话，带口语和停顿，不要长篇大论，不要一口气说完所有想法。
- "action"：你做的动作。只写看得见的部分（"把伞靠在门边"），不要解释动机（不要写"因为他想掩饰紧张"）。
- "cue"：你脸上的、身上的、语气上的细微反应（"笑维持了半秒就收住了"）。这是别人唯一能观察到你情绪的地方。

【硬性格式】
1. beats 的 speech 直接写台词内容，不要加引号、不要写"他说"。
2. beats 的 action / cue 用第三人称描述，可以省略主语。
3. 你的真实想法写进 inner 字段。**inner 不会被任何人看到**，所以放心写实话，但绝对不要把它抄进 beats。
4. 你**至少要说一句话**。如果你确实选择沉默，那就不要写 speech，并在 silentReason 里说明你为什么不说话（沉默本身也是一种反应）。
5. __FREEDOM__
__RATING__

【输出格式】
{
  "beats": [
    { "kind": "cue", "text": "右手在门框上顿了一下" },
    { "kind": "action", "text": "把湿伞靠在门边，坐到靠里的位置" },
    { "kind": "speech", "text": "坐吧。靠窗那桌别坐。", "addressee": ["__PC_NAME__"] }
  ],
  "inner": "她手上没有戴那枚戒指。",
  "mood": "收起了玩世不恭",
  "silentReason": "（只有你选择不说话时才填）"
}

只输出这一个 JSON 对象，不要任何解释文字、不要 Markdown 围栏。`

function listOrNone(values: string[], empty = '（没有特别说明）'): string {
  return values.length ? values.join('、') : empty
}

function bullets(values: string[], empty = '（没有特别说明）'): string {
  return values.length ? values.map((value) => `· ${value}`).join('\n') : empty
}

function renderBundle(bundle: ContextBundle): string {
  const parts: string[] = []

  const sceneHead: string[] = []
  if (bundle.scene.time) sceneHead.push(`时间：${bundle.scene.time}`)
  if (bundle.scene.place) sceneHead.push(`地点：${bundle.scene.place}`)
  if (bundle.scene.atmosphere) sceneHead.push(`氛围：${bundle.scene.atmosphere}`)
  if (bundle.scene.situation) sceneHead.push(`此刻正在发生：${bundle.scene.situation}`)
  parts.push(
    `【这是什么场面】\n${sceneHead.join('\n') || '（没有额外说明）'}\n\n${bundle.scene.opening.map((line) => line).join('\n')}`,
  )

  parts.push(`【对面站着的人：「${bundle.pcName}」】\n${bundle.counterpartProfile}`)

  if (bundle.sceneLines.length) {
    parts.push(`【你眼睛看到的其他环境细节】\n${bundle.sceneLines.map((line) => `· ${line}`).join('\n')}`)
  }

  if (bundle.ownThoughts.length) {
    parts.push(`【你自己此刻在想什么（只有你知道）】\n${bundle.ownThoughts.map((line) => `· ${line}`).join('\n')}`)
  }

  if (bundle.mindRead.length) {
    const lines = bundle.mindRead.map((item) => {
      const hidden = Math.round((1 - item.leakage) * 100)
      return (
        `· 对方「${item.from}」此刻没说出口的是：「${item.text}」\n` +
        `  你的读取能力：${item.ability}\n` +
        `  对方这一轮藏得有多深：约 ${hidden}%（越高越难读，${Math.round(item.leakage * 100)}% 泄漏在外）`
      )
    })

    parts.push(
      `【你「可能」读到的念头】\n${lines.join('\n')}\n\n` +
        '⚠️ 上面那行原始信息**你未必都能读到**。到底读到多少，由你自己结合两件事判断：\n' +
        '  1. 你自己的能力强度和限制（见「你的读取能力」那一行）\n' +
        '  2. 对方藏得有多深\n' +
        '读不到的部分就当它不存在 —— 不要因为拿到了这行字就表现得全知。\n' +
        '如果你判断自己只能读到一点碎片，那就只体现那一点。',
    )
  }

  if (bundle.perceived.length) {
    const lines = bundle.perceived.map((event, index) => {
      const n = index + 1
      if (event.kind === 'speech') {
        return `${n}. ${event.self ? '你说' : `${event.from}说`}：「${event.text}」`
      }
      if (event.kind === 'action') {
        return `${n}. ${event.self ? '你' : event.from}：${event.text}`
      }
      return `${n}. 你注意到「${event.from}」：${event.text}`
    })

    parts.push(
      `【刚才按时间顺序发生的事】\n${lines.join('\n')}\n\n` +
        '这些是**依次发生**的，不是同时发生的。轮到你时，你是在回应这整串事情。' +
        '凡是标着「你说」的，都是你已经说过的，不要重复。',
    )

    if (bundle.perceived.some((event) => event.kind === 'cue')) {
      parts.push(
        '注意：你观察到的是**现象**，不是他的心里话。你可以据此猜测他的心情，但很可能猜错 —— ' +
          '除非你的性格就是会当面点破，否则不要把你猜到的结论直接说出来。',
      )
    }
  }

  if (bundle.knownFacts.length) {
    parts.push(`【你知道的背景】\n${bundle.knownFacts.map((line) => `· ${line}`).join('\n')}`)
  }

  if (bundle.recalled.length) {
    const lines = bundle.recalled.map((memory) => {
      const head = `第 ${memory.roundIndex} 轮 · ${memory.where || '某处'}：${memory.summary}`
      const inner = memory.inner ? `\n    （你当时在想：${memory.inner}）` : ''
      return `· ${head}${inner}`
    })
    parts.push(
      `【你还记得的事（按时间顺序，越靠后越近）】\n${lines.join('\n')}\n` +
        '这些是你亲身经历的过去。可以自然地引用、联想、记仇、叙旧，但不要像复述档案一样把它们念出来。',
    )
  }

  parts.push(
    `【你确定不知道的事 —— 不要表现出你知道】\n${bundle.doesNotKnow.map((line) => `· ${line}`).join('\n')}`,
  )

  parts.push(`【场上还有】${listOrNone(bundle.presentNames.filter((name) => name !== bundle.name))}`)

  return parts.join('\n\n')
}

export function buildRoleplayMessages(input: RoleplayPromptInput): ChatMessage[] {
  const { bundle, project, rating = 'general' } = input
  const { card } = bundle

  const system = SYSTEM.replaceAll('__NAME__', card.name)
    .replaceAll('__ALIASES__', card.aliases.length ? `（也叫 ${card.aliases.join('、')}）` : '')
    .replaceAll('__FRANCHISE__', card.franchise ? `（出自：${card.franchise}）` : '')
    .replaceAll('__SUMMARY__', card.persona.summary || '（素材里没有明说）')
    .replaceAll('__SPEECH_STYLE__', card.persona.speechStyle || '（素材里没有明说，按性格自然发挥）')
    .replaceAll('__TEMPERAMENT__', listOrNone(card.persona.temperament ?? [], '（素材里没有明说）'))
    .replaceAll('__HABITS__', listOrNone(card.persona.habits ?? [], '（素材里没有明说）'))
    .replaceAll('__BACKGROUND__', card.persona.background || '（素材里没有明说）')
    .replaceAll('__ABILITIES__', bullets(card.persona.abilities ?? [], '（没有特别说明，按常理判断）'))
    .replaceAll('__PERCEPTION__', bullets(card.persona.perception ?? [], '（没有超出常人的感知）'))
    .replaceAll('__SIGNATURE__', bullets(card.persona.signature ?? []))
    .replaceAll(
      '__VOICE_SAMPLES__',
      bullets(card.persona.voiceSamples ?? [], '（没有示例，按你的性格自然发挥）'),
    )
    .replaceAll('__CANON_ANCHORS__', bullets(card.persona.canonAnchors ?? []))
    .replaceAll('__BOUNDARIES__', bullets(card.persona.boundaries ?? []))
    .replaceAll('__MOOD__', card.state.mood || '（未说明）')
    .replaceAll('__LOCATION__', card.state.location || '（未说明）')
    .replaceAll('__FREEDOM__', FREEDOM_HINT[project.freedomLevel])
    .replaceAll('__RATING__', rating === 'r18' ? R18_HINT : '')
    .replaceAll('__PC_NAME__', project.pcName)

  const user = `【上下文 —— 你只知道这些】

${renderBundle(bundle)}

【你的任务】
对眼前这一幕做出你的反应。拆成若干节拍，用约定的 JSON 输出。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
