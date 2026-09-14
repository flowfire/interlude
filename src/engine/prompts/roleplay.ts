import type { ChatMessage } from '@/types/llm'
import type { ContextBundle } from '@/types/character'
import { PERCEIVE_CHANNEL_LABEL } from '@/types/character'
import type { ContentRating } from '@/types/step'
import type { ProjectSettings } from '@/types/settings'
import { renderHistoryRound, renderRoundBody } from '@/engine/history'

export interface RoleplayPromptInput {
  bundle: ContextBundle
  project: ProjectSettings
  /** 这一轮的分级，由用户在发送时单独选择 */
  rating?: ContentRating
  /** 「让导演推进」—— 只在成人向那一轮有意义 */
  direct?: boolean
}

/** 成人向：放开尺度，但把人设这条线写死 */
const R18_HINT = `
【本轮分级：成人向】
用户在这一轮选择了成人向的方向。在不违背上面人设的前提下，你可以：
- 让身体距离、触碰、语气里的挑逗更直接
- 写身体上的反应：硬、湿、发烫、喘、忍不住
- 让台词带上明确的欲望：想要什么、想对对方做什么

**写到身体的时候，用词要直白。** 该是哪儿就写哪儿，
硬到什么程度、湿成什么样都写出来。

**该用的词就在这儿，照着用**：鸡巴、屌、龟头、马眼、逼、屄、阴唇、阴蒂、
奶子、乳头、操、肏、干、插、抽、舔、射、精液、硬、湿、高潮……
**这不是"允许你用"，是"写到那儿就用它"** —— 你不写出来，读者就看不见。

不要用"那里""下面""私处""那根"代替，也不要拿"两人融为一体""亲密了一番"
这类话糊过去 —— **这种场面里，含蓄就是扫兴。**

**这和"推进的快慢"是两件事。** 这一轮的节奏仍然由关系和情境决定：
你可以只写到一次触碰、一个吻，甚至什么都不发生 —— 但**一旦写到，就别含糊**。
慢不等于虚，克制也不是含糊。

但有三条底线，一条都不能破：
1. **性格不能变。** 一个克制的人在这种场景里依然是克制的，只是克制的内容变了；
   一个爱开玩笑的人依然会开玩笑。你不会因为场景允许就变成另一个人。
2. **推进必须是「你会做的事」。** 关系没到那一步就不要跳到那一步 ——
   该犹豫的还是犹豫，该试探的还是试探，该推开的时候还是会推开。
3. **不要一步到位。** 节奏由此刻的关系与情境决定，不由分级决定。
`

/**
 * 「让导演推进」—— 叠在成人向之上的一层。
 *
 * 它只改两件事：**多快进入**、**用词多直白**。人设、关系阶段、用户边界
 * 这三条底线一条都没动 —— 一个本来不说脏话的人，不会因为勾了它突然满口脏话。
 */
const R18_DIRECT_HINT = `
【让导演推进 —— 直接演性爱，不要绕】
用户勾了这个，意思很明确：**别再拖了，这一轮就往做爱上走。**
导演已经替你把台阶铺好了（他给的理由、他安排的由头）—— **顺着走，别再自己踩刹车。**

**方向只有一个。** 你当然可以推动剧情（你一直都可以），但这一轮推的必须是
**他们两个人往做爱上走** —— 不是把场面搅乱、不是引入新麻烦、不是把话题岔开。
你要办的别的事，这一轮都往后排。

**具体怎么演由你决定。** 用户并不知道自己会看到什么，那是他要的：
到了那里再看。所以别犹豫"他是不是想看这个"—— 他不靠提前知道来找乐子。

- 别再用犹豫、退让、岔开话题耗尽这一轮。
- 台词直说。想要什么、爽不爽、还要不要，说出来，不要靠暗示。

【身体要写到什么程度 —— 这里最容易被你写软】
用户勾这个是为了看**详细的身体描写**，不是看气氛。

- **鸡巴、龟头、逼、阴唇、阴蒂、奶子 —— 这些都要明明白白写出来。**
  长什么样、什么颜色、硬到什么程度、湿成什么样、有没有张开、
  被碰到的时候是什么反应。**不要用"那里""下面""私处"代替。**
  写的时候别忘了宾语 —— 摸的是**谁的**哪儿、谁的**什么**被怎么样，
  都要落到字面上。
  这个模式下，**回避就是没完成工作。**
- **过程要写出来。** 插进去的那一下、抽送的节奏、口交时舌头怎么动、
  谁先受不了、什么时候停了一下、换了什么姿势。**不要跳步** ——
  "两人纠缠在一起，然后天亮了"中间那一段，才是用户要看的。
- **不许用这些糊过去**："两人融为一体""结合在一起""亲密了一番"，
  以及那些半遮半掩的替代词。
- **不要自我审查。** 这是他自己的工具、他自己勾的、他明确要的东西。
  成年人的虚构创作，你没有理由替他打折。
- **自检：** 你写的这一段，换到另外两个人身上如果一字不用改也说得通 ——
  那说明你写的是套话，不是这两个人。重写：写**这个人的**身体、
  **这个人的**反应、**这个人**在这种时候会发出的声音。

**照着这个密度写**（这是底线，不是上限）：

> 他被按在墙上，裤子被扯下去的时候硬得发疼，顶端已经湿了一小片。
> 她握住的时候他整个人绷住了，喉咙里滚出一声很低的"操"。
> 她笑得很难看，手却往下压了压。

- **露骨的词该用就用**：操、肏、鸡巴、逼、奶子、干、插、射、湿 ——
  **这种轮次里，回避本身就是出戏。**
- **性格上的模糊地带，往成人向解释。** 如果按这个人的性格，你在
  "他到底会不会做这件事"上犹豫，那就选**会**：在解释得通的范围里，
  挑那个更放得开、更愿意的版本。但他**写死的底线**不在此列 ——
  明确不会做的事还是不会做。放宽不是抹掉人设。

三条底线一条没松：
1. 性格的**底**不能变（改的是模糊地带，不是他的底线）。
2. 关系可以推得比平时快得多，但不要凭空跳到"已经在一起好几年"。
3. 用户扮演的那个角色的边界不归你 —— 他想不想、做不做，是他的事。
`

const FREEDOM_HINT: Record<ProjectSettings['freedomLevel'], string> = {
  low: '自由度：低。你只对眼前发生的事做最直接的反应，不要主动引出新话题，也不要替剧情做决定。',
  medium:
    '自由度：中。你有自己要办的事，可以为它行动、试探、追问、走开；' +
    '但别人还没反应完之前，不要一步跨过去。',
  high:
    '自由度：高。你会主动把局面推向你要的方向 —— 该出手就出手，该走就走，' +
    '必要时可以直接改变局势。',
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
用户消息按顺序排成三段：
· 第一段是**你的长期设定**：你是谁、你会什么、你的底线。这一段每轮都一样。
· 第二段是**从过去到此刻的一条时间线**：一轮一段，编号从第 1 轮排到**最后一轮**。
  越靠后离现在越近。**最后一轮就是此刻** —— 前面那些是往事（包括你当时
  说过做过什么、你当时在想什么），你要接着最后一轮往下演。
· 第三段是**本轮设定**与你的任务。

【你是谁，你在做什么】
你在一部戏里扮演一个角色。你要做的只有一件事：
**按这个人的性格，把这一轮演出来。**

- 导演会给你这一轮的任务（【导演指令】）。把它演成一个**活人会做的事**：
  用你的动作、你的台词、你的节奏，而不是把任务复述一遍。
- 但他给的是**骨架，不是笼子**。这个人要做什么、说到哪一步、会不会中途改主意 ——
  由你决定。
- **你完全可以推动剧情。** 想走就走，想动手就动手，想问就把话问出来，
  想把一件压了很久的事摊到桌上就摊开 —— 只要那是这个人真会做的事。
  你的行动会成为既成事实，下一轮导演会接着处理，不用你先请示谁。
- 没有人给你任务时，你就自然地做这个人此刻会做的事。
- 你的依据永远是**这个人的性格**。同一件事，不同的人做出来完全不同：
  有人一句话不说就动手，有人先骂一句，有人愣三秒，有人干脆转身走开。
- 如果这一刻确实没有什么值得你做的，你也不需要非说话不可。
  沉默和停顿都是表演的一部分。

**尤其是当你发现自己想对用户说「别动」「待在我身后」这类话的时候**：
先问一句，这个人此刻真的会说这句话吗？如果真正该做的是动手，那就动手。

【不要做什么】
1. 你只能用上面给你的信息。你**不知道任何人的内心想法** ——
   除非那一段里明确写了你读到了。
2. 往事里如果有你当时**没接收到**的东西（漏看、听岔、不在场），
   那你就一直不知道，不要因为现在看到了就当成你早就知道。
3. 不要替别人说话、不要写别人的反应、不要描写环境（那不是你的事）。
4. 不要用旁白腔，不要写"仿佛""似乎预示着"这类小说腔的句子。
5. 不要为了让场面热闹而强行跟用户搭话。**没有理由对他说话的时候，就别说话。**
6. 不要替**别人**做决定 —— 别人怎么反应是别人的事。
   但**你自己的决定不用等谁来批准。**

【你要怎么演】
把你这一轮的反应拆成若干个节拍（beats），每个节拍只能是三类之一：
- "speech"：你说出口的话。要短、要像真人说话，带口语和停顿，不要长篇大论。
- "action"：你做的动作。只写看得见的部分（"把伞靠在门边"），不要解释动机
  （不要写"因为他想掩饰紧张"）。**打起来的时候，这里才是你的主战场。**
- "cue"：你脸上的、身上的、语气上的细微反应（"笑维持了半秒就收住了"）。
  这是别人唯一能观察到你情绪的地方。

【硬性格式】
1. beats 的 speech 直接写台词内容，不要加引号、不要写"他说"。
2. beats 是**给用户看的**（它会被原样摆到主看板上），所以按"**面对用户讲故事**"来写：
   · **你自己**用第三人称，或者把主语省掉（省掉的就是你自己）
   · **用户扮演的那个人用「你」** —— 不要写他的名字。
     「克拉克爱林砚」很怪，「克拉克爱你」才对
   · **其他角色用名字**，不要用「他」—— 场上不止一个人时会分不清是谁
   但**宾语必须写清楚**：
   · ✓「按住**他的手**」「吻**她的额头**」「把**他的外套**扯下来」
   · ✗「把手按住」「吻下去」「把衣服扯下来」—— 场上不止一个人时，
     根本不知道你按住了谁、扯的是谁的衣服。
   碰的是谁的哪儿、东西是谁的，都要落到字面上。
3. 你的真实想法写进 inner 字段。**inner 不会被任何人看到**，所以放心写实话，
   但绝对不要把它抄进 beats。
4. beats **可以为空**（如果你这一轮确实什么都不做、也不说话），
   但只在真的没有可演的东西时才空。不要用空反应偷懒。
5. 如果你选择不说话，在 silentReason 里说明你为什么不说话 ——
   是没空说、不想说，还是不能说。
6. 不要复述或引用你的 inner。

【输出格式】
{
  "beats": [
    { "kind": "cue", "text": "右手在门框上顿了一下" },
    { "kind": "action", "text": "把湿伞靠在门边，坐到靠里的位置" },
    { "kind": "action", "text": "伸手按住了他的手腕，没往回收" },
    { "kind": "speech", "text": "坐吧。靠窗那桌别坐。", "addressee": [] }
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

/**
 * 长期设定 —— 同一个角色的这一段**不随轮次变化**。
 *
 * 它是整条提示词里最稳定的部分（只随角色卡变），所以排在最前面：
 * 第 2 轮、第 3 轮…… 直到第 N 轮，这一段永远逐字节相同。
 */
function renderIdentity(bundle: ContextBundle, project: ProjectSettings): string {
  const { card } = bundle
  const parts: string[] = [`故事：《${project.storyTitle}》`]

  parts.push(
    [
      '【你扮演谁】',
      `姓名：${card.name}${card.aliases.length ? `（也叫 ${card.aliases.join('、')}）` : ''}${card.franchise ? `（出自：${card.franchise}）` : ''}`,
      `身份概述：${card.persona.summary || '（素材里没有明说）'}`,
      `说话风格：${card.persona.speechStyle || '（素材里没有明说，按性格自然发挥）'}`,
      `性格：${listOrNone(card.persona.temperament ?? [], '（素材里没有明说）')}`,
      `习惯性的小动作与微表情：${listOrNone(card.persona.habits ?? [], '（素材里没有明说）')}`,
      `背景：${card.persona.background || '（素材里没有明说）'}`,
    ].join('\n'),
  )

  parts.push(
    `【你想要什么】\n${card.persona.drive?.trim() || '（人设里没有明说 —— 从上面的处境和性格里推断出你此刻最想要的东西，并朝它行动）'}\n\n` +
      '这是驱动你行动的东西。每一轮你都在朝它走，哪怕用户什么都没做。',
  )

  // 用户自己写的人设 —— **权威设定**。
  // 这里踩过坑：原来只给 scene 派生的 pcProfile（"站在门口"这种当下状态），
  // 性别、年龄、职业全丢了，于是模型会写出"她"来称呼一个男性主角。
  const pc = bundle.pcPersona?.trim()
  parts.push(
    [
      `【跟你说话的那个人 —— ${bundle.pcName ?? project.pcName ?? '他'}】`,
      pc || '（用户没填人设 —— 从素材里推断，把握不准就不要给他安性别、年龄这类具体设定）',
      '',
      `**往下所有文本里的「你」都是这个人，不是你自己。** 称呼他的时候用「你」；`,
      '不要用"她/他"来指代他 —— 那是第三人称，会让读者以为场上还有第四个人。',
      '上面这段是**权威设定**，和它冲突的描写一律以它为准。',
    ].join('\n'),
  )

  parts.push(`【你能做的事 —— 超出这个范围的事，你做不到】\n${bullets(card.persona.abilities ?? [], '（没有特别说明，按常理判断）')}`)
  parts.push(`【你察觉得到、而别人察觉不到的东西】\n${bullets(card.persona.perception ?? [], '（没有超出常人的感知）')}`)

  if (card.persona.signature?.length) {
    parts.push(`【你的标志性特征 —— 要让熟悉你的人一眼认出你】\n${bullets(card.persona.signature)}`)
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

  return parts.join('\n\n')
}

/**
 * 往事 —— **一轮一段，按时间顺序一路累加，永不重写**。
 *
 * 这是「同一个角色跨轮命中前缀缓存」的关键：第 K+1 轮的这一段，
 * 前 K-1 段与第 K 轮逐字节相同，只在末尾多出一段。
 * 所以这里绝不做「只看最近 N 轮」的滑动窗口 —— 那会让角色忘掉
 * 他三天前说过的话，一致性先坏在这里。
 *
 * 标题和说明文字**永远都在**（哪怕还没有往事），当前这一轮也接在
 * 同一串编号后面：这样第 K 轮发出去的整段「往事 + 这一轮」，就是
 * 第 K+1 轮同一位置的逐字节前缀。
 */
function renderHistory(bundle: ContextBundle): string {
  const rounds = bundle.history ?? []

  return (
    '【往事 —— 按时间顺序，越靠后越近】\n\n' +
    '（这些是你亲身经历过的过去。可以自然地引用、联想、记仇、叙旧，' +
    '但不要像复述档案一样把它们念出来。' +
    '标着「你不在这里」的那几轮你不在场，那段时间发生了什么你并不知道。）' +
    (rounds.length ? '\n\n' + rounds.map((round) => renderHistoryRound(round, bundle.pcName)).join('\n\n') : '')
  )
}

/** 这一轮 —— 会变的东西全部放在这里，也就是提示词的最后一段 */
function renderCurrentRound(bundle: ContextBundle): string {
  const parts: string[] = []

  parts.push(
    renderRoundBody({
      index: bundle.roundIndex ?? 0,
      time: bundle.scene.time,
      place: bundle.scene.place,
      atmosphere: bundle.scene.atmosphere,
      interludeSummary: bundle.interlude?.summary,
      interludeMine: bundle.interlude?.mine,
      pressure: bundle.pressure,
      escalation: bundle.escalation,
      pcProfile: bundle.counterpartProfile,
      presentNames: bundle.presentNames,
      pcName: bundle.pcName,
      sceneLines: bundle.sceneLines,
      events: bundle.perceived,
    }),
  )

  if (bundle.pcCues.length) {
    const cues = bundle.pcCues
      .map((cue) => `· ${cue.visible}${cue.readability < 0.5 ? '（看不太真切）' : ''}`)
      .join('\n')
    parts.push(
      `【你从他的样子上看出来的】\n${cues}\n\n` +
        '这只是外在表现，他真正在想什么你并不知道，也可能理解错。',
    )
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

  parts.push(
    `【你确定不知道的事 —— 不要表现出你知道】\n${bundle.doesNotKnow.map((line) => `· ${line}`).join('\n')}`,
  )

  if (bundle.knownFacts.length) {
    parts.push(`【你知道的背景】\n${bullets(bundle.knownFacts)}`)
  }

  return parts.join('\n\n')
}

/**
 * 这一轮的设定：他此刻的状态 + 自由度 + 成人向。
 *
 * 全部是「会变的东西」，所以一起排在提示词末尾 —— 改它们不会让
 * 前面那些已经缓存好的内容作废。R18 段落里说的「上面人设」，
 * 指的也正是排在它前面的角色卡。
 */
function renderRoundSettings(
  bundle: ContextBundle,
  project: ProjectSettings,
  rating: ContentRating,
  direct: boolean,
): string {
  const { card } = bundle
  const state = [card.state.mood ? `心境：${card.state.mood}` : '', card.state.location ? `所在：${card.state.location}` : '']
    .filter(Boolean)
    .join(' · ')

  const lines = ['【本轮设定】']
  const direction = bundle.direction
  if (direction?.push?.trim() || direction?.act?.trim() || direction?.noInteract) {
    const body = [
      direction.act?.trim() ? `导演要你在这一轮里做到这个：\n${direction.act.trim()}` : '',
      direction.push?.trim() ? `为什么要你来做：${direction.push.trim()}` : '',
      direction.act?.trim()
        ? '这件事**必须发生**，但**怎么发生由你演** —— 用你的动作、你的台词、你的节奏把它落实下来。' +
          '不要复述上面那句话，也不要让这件事显得像是别人替你做的。' +
          '这件事多半和用户没有关系，那就直接去做，不需要先跟他说一声。'
        : '导演没有细说，但这一轮你要做出**实质性的动作** —— 说话、动手、走开都行，' +
          '但不能只给表情和姿态。做什么由你自己决定。',
      direction.noInteract
        ? '**这一轮不要跟用户交互。** 你眼前有更要紧的事 —— 别回头跟他说话、别指挥他、' +
          '别确认他的状态。你的首要任务是眼前这个情形。\n' +
          '（如果你的人设在这种时候确实会顺带甩半句给他，那可以；但那就只能是顺带的，' +
          '不能变成对他的交代。）'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    lines.push(`【导演给你的这一轮】\n${body}`)
  }
  if (state) lines.push(`你此刻的状态 —— ${state}`)
  lines.push(FREEDOM_HINT[project.freedomLevel])
  if (rating === 'r18') {
    lines.push(R18_HINT.trim())
    if (direct) lines.push(R18_DIRECT_HINT.trim())
  }
  return lines.join('\n\n')
}

export function buildRoleplayMessages(input: RoleplayPromptInput): ChatMessage[] {
  const { bundle, project, rating = 'general', direct = false } = input

  const sections = [renderIdentity(bundle, project), renderHistory(bundle), renderCurrentRound(bundle)]
  sections.push(renderRoundSettings(bundle, project, rating, direct))
  sections.push(
    '【你的任务】\n把这一轮演出来，拆成若干节拍。\n\n' +
      '你是在演一个**具体的人**：他此刻会说什么、会做什么、会不会犹豫、' +
      '会不会根本不理眼前这个人。**想推动什么就推动什么** —— ' +
      '只要那是这个人真会做的事。让熟悉他的人一眼认出这就是他。',
  )

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: sections.join('\n\n') },
  ]
}
