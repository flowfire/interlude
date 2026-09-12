import type { ChatMessage } from '@/types/llm'
import type { ContextBundle } from '@/types/character'
import { PERCEIVE_CHANNEL_LABEL } from '@/types/character'
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
`

const FREEDOM_HINT: Record<ProjectSettings['freedomLevel'], string> = {
  low: '自由度：低。你只对眼前这一句话做最直接的反应，不要主动引出新话题、不要推动剧情。',
  medium: '自由度：中。你可以在反应里加自己的动作和一到两句话，但不要主动改变剧情走向。',
  high: '自由度：高。你可以主动追问、试探、做决定，甚至把话题引向你想去的地方。',
}

/**
 * 通用指令 —— **一个字节都不随项目、轮次、角色变化**。
 *
 * 这是一个纯粹的前缀：只要用户第一次发过请求，之后所有请求
 * （包括换角色、换轮次、换分级、甚至换一个对话）都能命中这段缓存。
 * 自由度与分级这些「这一轮的设定」全部挪到 user 的末尾，它们会变，
 * 但它们在后面，改它们不会波及前面已经缓存好的内容。
 */
const SYSTEM = `你正在一部互动剧里扮演其中一个角色。你只演这一个角色，用这一个角色的眼睛看世界。

【你会收到的内容】
用户消息分成两段：
· 前半段是**所有在场角色共享的背景**：故事、客观环境、前几轮已经演过的内容。
· 后半段是**只属于你的部分**：你扮演谁、你记得什么、你此刻实际接收到了什么。
两段之间有一条分隔线。

【你不能做什么】
1. 你只能使用「只属于你的部分」和共享背景里给你的信息。
   你**不知道任何人的内心想法** —— 除非那一段里明确写了你读到了。
2. 不要替别人说话、不要写别人的反应、不要描写环境。
3. 不要用旁白腔，不要写"仿佛""似乎预示着"这类小说腔的句子。

【你要怎么演】
把你这一轮的反应拆成若干个节拍（beats），每个节拍只能是三类之一：
- "speech"：你说出口的话。要短、要像真人说话，带口语和停顿，不要长篇大论。
- "action"：你做的动作。只写看得见的部分（"把伞靠在门边"），不要解释动机
  （不要写"因为他想掩饰紧张"）。
- "cue"：你脸上的、身上的、语气上的细微反应（"笑维持了半秒就收住了"）。
  这是别人唯一能观察到你情绪的地方。

【硬性格式】
1. beats 的 speech 直接写台词内容，不要加引号、不要写"他说"。
2. beats 的 action / cue 用第三人称描述，可以省略主语。
3. 你的真实想法写进 inner 字段。**inner 不会被任何人看到**，所以放心写实话，
   但绝对不要把它抄进 beats。
4. 你**至少要说一句话**。如果你确实选择沉默，那就不要写 speech，
   并在 silentReason 里说明你为什么不说话（沉默本身也是一种反应）。
5. 不要复述或引用你的 inner。

【输出格式】
{
  "beats": [
    { "kind": "cue", "text": "右手在门框上顿了一下" },
    { "kind": "action", "text": "把湿伞靠在门边，坐到靠里的位置" },
    { "kind": "speech", "text": "坐吧。靠窗那桌别坐。", "addressee": [] }
  ],
  "inner": "她手上没有戴那枚戒指。",
  "mood": "收起了玩世不恭",
  "silentReason": "（只有你选择不说话时才填）"
}

只输出这一个 JSON 对象，不要任何解释文字、不要 Markdown 围栏。`

export const SEPARATOR = '━━━━━━━━━━━━━━━ 以下只属于「你」━━━━━━━━━━━━━━━'

function listOrNone(values: string[], empty = '（没有特别说明）'): string {
  return values.length ? values.join('、') : empty
}

function bullets(values: string[], empty = '（没有特别说明）'): string {
  return values.length ? values.map((value) => `· ${value}`).join('\n') : empty
}

/**
 * 共享背景段 —— 同一轮里**所有角色收到的一模一样**。
 *
 * 放在提示词最前面，是为了让这部分（往往是最长的：前文回顾 + 环境）
 * 能够命中 prompt 前缀缓存。
 */
function renderShared(bundle: ContextBundle, project: ProjectSettings): string {
  const sceneHead = [bundle.scene.time, bundle.scene.place, bundle.scene.atmosphere]
    .filter(Boolean)
    .join(' · ')

  const parts: string[] = ['【共享背景】', `故事：《${project.storyTitle}》`]

  if (sceneHead) parts.push(`时间地点：${sceneHead}`)
  parts.push(`对面站着的人：「${bundle.pcName}」—— ${bundle.counterpartProfile}`)

  // 注意：这里不能按「除了我以外还有谁」来写，否则每个角色的这一段都不一样，
  // 共享前缀就断了。在场名单本身是公开信息，直接把所有人都列出来即可。
  if (bundle.presentNames.length) parts.push(`在场的人：${bundle.presentNames.join('、')}`)

  // 老工作区里存的 ContextBundle 可能没有 recap，容错处理
  const recap = (bundle.recap ?? '').trim()
  if (recap) {
    parts.push(`【前面已经演过的内容】\n${recap}`)
  }

  return parts.join('\n\n')
}

/**
 * 角色专属段 —— 从这里开始每个角色各不相同，缓存不再共享。
 */
function renderPersonal(bundle: ContextBundle): string {
  const { card } = bundle
  const parts: string[] = []

  parts.push(
    [
      '【你扮演谁】',
      `姓名：${card.name}${card.aliases.length ? `（也叫 ${card.aliases.join('、')}）` : ''}${card.franchise ? `（出自：${card.franchise}）` : ''}`,
      `身份概述：${card.persona.summary || '（素材里没有明说）'}`,
      `说话风格：${card.persona.speechStyle || '（素材里没有明说，按性格自然发挥）'}`,
      `性格：${listOrNone(card.persona.temperament ?? [], '（素材里没有明说）')}`,
      `习惯性的小动作与微表情：${listOrNone(card.persona.habits ?? [], '（素材里没有明说）')}`,
      `背景：${card.persona.background || '（素材里没有明说）'}`,
      `此刻心境：${card.state.mood || '（未说明）'}`,
      `此刻所在：${card.state.location || '（未说明）'}`,
    ].join('\n'),
  )

  const abilities = bullets(card.persona.abilities ?? [], '（没有特别说明，按常理判断）')
  parts.push(`【你能做的事 —— 超出这个范围的事，你做不到】\n${abilities}`)

  const perception = bullets(card.persona.perception ?? [], '（没有超出常人的感知）')
  parts.push(`【你察觉得到、而别人察觉不到的东西】\n${perception}`)

  const signature = bullets(card.persona.signature ?? [])
  if (card.persona.signature?.length) {
    parts.push(`【你的标志性特征 —— 要让熟悉你的人一眼认出你】\n${signature}`)
  }

  if (card.persona.voiceSamples?.length) {
    parts.push(
      `【你的说话方式参考】\n下面这些是**语气示例**，用来帮你找准用词习惯和句长，不是你必须说的台词：\n` +
        bullets(card.persona.voiceSamples),
    )
  }

  if (card.persona.canonAnchors?.length) {
    parts.push(`【原作里确定的事实 —— 不要与之矛盾】\n${bullets(card.persona.canonAnchors)}`)
  }

  if (card.persona.boundaries?.length) {
    parts.push(`【你绝对不会做的事、不会说的话】\n${bullets(card.persona.boundaries)}`)
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

  if (bundle.sceneLines.length) {
    parts.push(`【你眼前的环境】\n${bundle.sceneLines.join('\n')}`)
  }

  if (bundle.ownThoughts.length) {
    parts.push(`【你自己此刻在想什么（只有你知道）】\n${bundle.ownThoughts.map((line) => `· ${line}`).join('\n')}`)
  }

  if (bundle.extras.length) {
    const lines = bundle.extras.map((item) => {
      const label = PERCEIVE_CHANNEL_LABEL[item.channel] ?? '察觉'
      const certainty = item.certainty < 0.7 ? `（把握 ${Math.round(item.certainty * 100)}%）` : ''
      return `· ${label}：${item.text}${certainty}`
    })
    parts.push(
      `【你额外察觉到的】\n${lines.join('\n')}\n\n` +
        '这是你的感官**实际捕捉到**的东西 —— 没捕捉到的部分已经被滤掉了，所以这就是你这次的收获。\n' +
        '把握不高时，你可以表现得不确定，也可能误判。不要表现得比你实际察觉到的更全知。',
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
      `【你实际接收到的事（按时间顺序）】\n${lines.join('\n')}\n\n` +
        '这些是**依次发生**的，不是同时发生的 —— 没轮到你的时候你只是看着、听着。\n' +
        '凡是标着「你说」的，都是你已经说过的，不要重复。',
    )
  }

  parts.push(
    `【你确定不知道的事 —— 不要表现出你知道】\n${bundle.doesNotKnow.map((line) => `· ${line}`).join('\n')}`,
  )

  if (bundle.knownFacts.length) {
    parts.push(`【你知道的背景】\n${bullets(bundle.knownFacts)}`)
  }

  parts.push('【你的任务】\n对眼前这一幕做出你的反应。拆成若干节拍，用约定的 JSON 输出。')

  return parts.join('\n\n')
}

/**
 * 这一轮的设定（自由度 + 分级）—— 放在最末尾。
 *
 * 它们会随项目设置或用户每轮勾选的复选框变化，属于「会变的东西」，
 * 所以刻意不给它们靠前的位置：改这两项不会让前面的缓存全部作废。
 * 同时放在最后也正好是人设之后，R18 段落里「不违背上面人设」指向明确。
 */
function renderRoundSettings(project: ProjectSettings, rating: ContentRating): string {
  const lines = [`【本轮设定】`, FREEDOM_HINT[project.freedomLevel]]
  if (rating === 'r18') lines.push(R18_HINT.trim())
  return lines.join('\n\n')
}

export function buildRoleplayMessages(input: RoleplayPromptInput): ChatMessage[] {
  const { bundle, project, rating = 'general' } = input

  const user = [
    renderShared(bundle, project),
    SEPARATOR,
    renderPersonal(bundle),
    renderRoundSettings(project, rating),
  ].join('\n\n')

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}
