import { describe, expect, it } from 'vitest'
import { composeScene } from '@/engine/stages/s7-compose'
import { buildPerceiveCandidates } from '@/engine/stages/s3b-perceive'
import { buildSituationMessages } from '@/engine/prompts/situation'
import { runSituationStage } from '@/engine/stages/s3c-situation'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { ContextBundle, HistoryRound } from '@/types/character'
import type { SituationState } from '@/types/situation'
import type { SceneSetup } from '@/types/scene'
import type { Segment } from '@/types/segment'
import { IDLE_INPUT } from '@/types/step'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import type { LlmClient } from '@/engine/llm/client'

const situation: SituationState = {
  pressure: '狼群在二十步外压成半圆',
  escalation: '再有两三息它们就会扑上来',
  events: [
    { kind: 'ambient', text: '左侧灌木丛里传来一声很低的喉音' },
    { kind: 'scene', text: '最前面那两头伏低了身子' },
  ],
  backstory: '',
  reason: '',
  holdUp: '',
  routes: [],
  r18Streak: 1,
  suggestR18: false,
  sexScore: 0,
  prevSexScore: 0,
  pace: 'escalate',
  r18Ended: false,
  directions: [],
  order: ['金刚狼', '阿七'],
  usedModel: true,
}

const setup: SceneSetup = {
  inputMode: 'dialogue',
  time: '夜里',
  place: '林子里',
  atmosphere: '风停了',
  opening: ['火堆只剩下一点红。'],
  situation: '你们被围住了。',
  pcProfile: '站在原地没动。',
  present: [
    { name: '金刚狼', role: '挡在前面', brief: '没回头', kind: 'character', active: true },
    { name: '我', role: 'pc', brief: '听着吩咐不动', kind: 'character', active: false },
  ],
  establishedBeats: [],
  usedModel: true,
}

function segments(): Segment[] {
  return [
    {
      id: 's1',
      kind: 'action',
      text: '我听着他的吩咐不动。',
      subject: ['我'],
      confidence: 1,
      isFact: false,
      lockedByUser: false,
      visibility: 'public',
      sourceRange: [0, 10],
      origin: 'rule',
    },
  ]
}

describe('局面推进：世界自己会往前走', () => {
  it('局面事件会进入信息分发的候选池，编号接着往后续', () => {
    const candidates = buildPerceiveCandidates({
      cards: [],
      segments: segments(),
      sceneSetup: setup,
      pcName: '我',
      situation,
    })

    const texts = candidates.map((item) => item.text)
    expect(texts).toContain('左侧灌木丛里传来一声很低的喉音')
    expect(texts).toContain('最前面那两头伏低了身子')
    // 编号必须连续，分发层是按编号取原文的
    expect(candidates.map((item) => item.ref)).toEqual(candidates.map((_, index) => index + 1))
    // 局面事件排在最后 —— 它是这一轮的推进，不是谁的言行
    expect(texts[texts.length - 1]).toBe('最前面那两头伏低了身子')
  })

  it('局面事件会进时间线，排在用户写的内容之后、角色反应之前', () => {
    const scene = composeScene({
      sceneSetup: setup,
      segments: segments(),
      cards: [],
      roleplays: [{ characterId: 'c1', name: '金刚狼', beats: [{ kind: 'action', text: '侧身让开第一头狼' }] }],
      pcName: '我',
      situation,
    })

    const kinds = scene.blocks.map((block) => block.kind)
    expect(kinds).toContain('world')

    const mine = scene.blocks.findIndex((block) => block.kind === 'pc-action')
    const world = scene.blocks.findIndex((block) => block.kind === 'world')
    const reaction = scene.blocks.findIndex((block) => block.kind === 'action' && block.characterName === '金刚狼')

    expect(mine).toBeGreaterThanOrEqual(0)
    expect(world).toBeGreaterThan(mine)
    expect(reaction).toBeGreaterThan(world)
  })

  it('节奏与上一轮的节奏都会交给导演，避免原地踏步', () => {
    const messages = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我听着他的吩咐不动。'),
      segments: segments(),
      sceneSetup: setup,
      drives: [{ name: '金刚狼', drive: '把这孩子活着带出去', brief: '挡在前面' }],
      previous: { pressure: '狼群在收紧', escalation: '它们会扑上来', pace: 'build' },
    })

    const [system, user] = messages
    // 导演要显式判断节奏，而不是把"快慢"交给角色的长期目标
    expect(system.content).toContain('不要连着两轮都停在 build')
    expect(system.content).toContain('如果用户下一轮什么都不写，剧情还会往前走吗')
    expect(system.content).toContain('"pace"')
    // 上一轮是铺垫，导演得知道
    expect(user.content).toContain('上一轮的节奏：build')
    // 压力要压在具体某个人的目标上
    expect(system.content).toContain('压力要压在**某个人的目标上**')
    expect(user.content).toContain('把这孩子活着带出去')
  })

  it('被点名的角色会收到导演的推力，没被点名的收不到', () => {
    const pushed = buildRoleplayMessages({
      bundle: {
        ...bundle(),
        direction: {
          push: '狼群已经贴到三步之内，站在你身后那个人会是第一个被扑倒的。',
          act: '他动了 —— 第一头狼刚扑上来就被他按进了泥里。',
        },
      },
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    expect(pushed).toContain('【导演给你的这一轮】')
    expect(pushed).toContain('狼群已经贴到三步之内')
    expect(pushed).toContain('第一头狼刚扑上来就被他按进了泥里')
    // 导演给的是剧情，怎么演是演员的事
    expect(pushed).toContain('怎么发生由你演')

    const plain = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(plain).not.toContain('【导演给你的这一轮】')
  })

  it('导演可以明确指示「这一轮不要跟用户交互」', () => {
    const pushed = buildRoleplayMessages({
      bundle: {
        ...bundle(),
        direction: { push: '狼群已经贴到三步之内', act: '他把第一头狼按进了泥里', noInteract: true },
      },
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    expect(pushed).toContain('这一轮不要跟用户交互')
    expect(pushed).toContain('别回头跟他说话')
    // 性格上确实会甩半句，可以；但不能变成交代
    expect(pushed).toContain('不能变成对他的交代')

    const without = buildRoleplayMessages({
      bundle: { ...bundle(), direction: { push: '狼群已经贴到三步之内' } },
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content
    expect(without).not.toContain('这一轮不要跟用户交互')
  })

  it('成人向那一轮，导演也拿到分级和边界', () => {
    const base = {
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
    }

    const [r18] = buildSituationMessages({ ...base, rating: 'r18' })
    // R18 = 「允许」：用户带到那儿才发生，导演不主动推
    expect(r18.content).toContain('成人向 —— 这是「允许」，不是「要求」')
    expect(r18.content).toContain('他不引导，你就不主动推进')
    expect(r18.content).toContain('但他一旦把剧情带到那儿，你必须接住')
    // 用词要直白、直接、粗俗 —— 这三个词用户要求直接写进去
    expect(r18.content).toContain('文字要直白、直接、粗俗')
    expect(r18.content).toContain('含蓄就是扫兴')
    // 落到导演的职责上：他能安排的是场面与剧情
    expect(r18.content).toContain('该写什么器官就写什么器官')
    // 三条底线一条不少
    expect(r18.content).toContain('人设的**底**不变')
    expect(r18.content).toContain('关系不凭空跳到')
    expect(r18.content).toContain('身体边界是用户的，不归你决定')
    // 导演手里还有刹车：写完了要能宣告收尾，否则会一路挂着
    expect(r18.content).toContain('【什么时候收尾】')
    expect(r18.content).toContain('自动退出成人向模式')
    expect(r18.content).toContain('也不要永远不结束')

    const [general] = buildSituationMessages({ ...base, rating: 'general' })
    expect(general.content).not.toContain('成人向')
  })

  it('导演每一轮都可以派任务，不是只有僵局才派', () => {
    const [system] = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我推门进来。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
    })

    // 三层定位
    expect(system.content).toContain('必须被采纳')
    expect(system.content).toContain('不要把决定权让出去')
    expect(system.content).toContain('他们也会自己推动剧情')
    // 派任务是本职，不限于僵局
    expect(system.content).toContain('每一轮都可以派，不是只有僵局才派')
    expect(system.content).toContain('用户扮演的角色永远不在名单里')
  })

  it('用自评替代硬性命令 —— 它自己看得见进度', () => {
    const base = {
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上了。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
      rating: 'r18' as const,
    }
    const sys = (streak: number, scores: number[], direct = false) =>
      buildSituationMessages({
        ...base,
        direct,
        r18Streak: streak,
        directStreak: direct ? streak : 0,
        recentScores: scores,
      })[0].content

    // 评分表要写明白：0 是程度的下限，100 是"已经在做"，100 以上是进度
    const first = sys(1, [])
    expect(first).toContain('【先给这一轮打分')
    expect(first).toContain('**100**：插进去了，正在做')
    expect(first).toContain('100 以上是进度')
    // 校准：脱了露了就已经 60 往上了，不许给 0
    expect(first).toContain('脱了、露了')
    expect(first).toContain('不是「做完没有」')
    expect(first).toContain('给 0 是在骗自己')
    expect(first).toContain('每多一轮 +10')
    expect(first).toContain('这是第一轮，还没有历史评分')

    // 历史回放给它看，而且它自己该看出没在涨
    const stuck = sys(4, [10, 10, 15])
    expect(stuck).toContain('10 → 10 → 15')
    expect(stuck).toContain('现在要打的是第 4 轮')
    expect(stuck).toContain('连着几轮几乎没动')
    expect(stuck).toContain('那不是在慢热，那是在磨')

    // 涨得正常就不点破
    expect(sys(4, [0, 50, 100])).not.toContain('连着几轮几乎没动')
  })

  it('评分字段必须出现在输出格式里 —— 漏了它模型就不会填，界面上永远是 0', () => {
    const [system] = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上了。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
      rating: 'r18',
      direct: true,
      r18Streak: 3,
      directStreak: 3,
      recentScores: [20, 40],
    })

    // 这是踩过的坑：提示词正文里讲了半天怎么打分，输出格式的 JSON 里却没有
    // sexScore 这个键 —— 模型自然不输出，引擎读不到就兜成 0。
    const formatSection = system.content.slice(system.content.indexOf('【输出格式】'))
    expect(formatSection).toContain('"sexScore"')
    expect(system.content).toContain('漏了就算这一轮没打分')
  })

  it('判断标准与借口清单还在 —— 自评不是放松要求', () => {
    const [system] = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上了。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
      rating: 'r18',
      r18Streak: 5,
      directStreak: 3,
      recentScores: [10, 10, 15],
    })

    expect(system.content).toContain('判断标准只有一个')
    expect(system.content).toContain('都不算理由')
    expect(system.content).toContain('时机未到 · 气氛差一点')
  })

  it('推不动的时候给用户几条可选方向，而不是硬拗或抗命', () => {
    const [system] = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我打开门，外面站着一个陌生人。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
      rating: 'r18',
      direct: true,
      r18Streak: 1,
      directStreak: 1,
    })

    expect(system.content).toContain('routes 不是兜底 —— 是常规手段')
    expect(system.content).toContain('推不动的时候**，routes 就从"手段"变成"义务"')
    // 三种处理的优先级要写清楚
    expect(system.content).toContain('能改就改')
    expect(system.content).toContain('确实改不了')
    // 明确两条禁令：不跳戏，也不许交一份无关的正常剧情
    expect(system.content).toContain('不要跳戏')
    expect(system.content).toContain('那是抗命')
    // routes 是给用户选的开场，不是替他做决定
    expect(system.content).toContain('给用户选的开场')
    expect(system.content).toContain('让他在你这里养伤')
    // 光说「做不到」不给方向，仍然算拖
    expect(system.content).toContain('然后什么都不给，那就是在拖')
    // 关键：告诉它 routes 会被渲染成按钮 —— 否则它会当成可选字段忽略，
    // 把方向写成 holdUp 里的一段散文，用户点不了
    expect(system.content).toContain('routes 是给用户用的')
    // 关键：必须是「用户视角、能直接用的」，不是剧情走向的描述
    expect(system.content).toContain('写成「他能直接说出口的话 / 做得出的动作」')
    expect(system.content).toContain('不是剧情往哪走的描述')
    expect(system.content).toContain('他点下去还得自己重写一遍，这个按钮就白给了')
    expect(system.content).toContain('我侧身让开门口')
    // 几条路都得通向做爱 —— 不是「接受 / 中立 / 拒绝」那种谱系
    expect(system.content).toContain('不是「接受 / 中立 / 拒绝」那种谱系')
    expect(system.content).toContain('是让他选"用哪种走法进去"')
    expect(system.content).toContain('最后那条等于在问"要不要"')
    expect(system.content).toContain('借着上药靠近')
    expect(system.content).toContain('直接把手按在他手上')
    expect(system.content).toContain('写在 holdUp 里没用')
  })

  it('导演知道最近几轮的节奏，用来判断该不该收场', () => {
    const messages = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我打了一拳。'),
      segments: [],
      sceneSetup: setup,
      drives: [],
      previous: {
        pressure: '还在打',
        escalation: '再打下去要出事',
        pace: 'climax',
        recentPaces: ['escalate', 'climax', 'climax'],
      },
    })

    const [system, user] = messages
    // 收场是一项独立职责，且提示词里写死了判据
    expect(system.content).toContain('【收场 —— 你的一项独立职责】')
    expect(system.content).toContain('那不是紧张，那是卡住了')
    expect(system.content).toContain('这一幕的**问题**有没有被回答')
    // 「不要解决冲突」这条禁令必须已经被拿掉
    expect(system.content).not.toContain('不要解决冲突')
    // 最近几轮节奏递给了导演
    expect(user.content).toContain('escalate → climax → climax')
  })

  it('僵局点名只针对角色，永远不点用户', () => {
    const [system] = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我站着不动。'),
      segments: [],
      sceneSetup: setup,
      drives: [{ name: '金刚狼', drive: '把这孩子活着带出去', brief: '挡在前面' }],
    })
    expect(system.content).toContain('绝对不要碰用户扮演的角色')
    expect(system.content).toContain('用户扮演的角色永远不在名单里')
    // 导演和演员的权限关系写在新版三层定位里
    expect(system.content).toContain('不要把决定权让出去')
    expect(system.content).toContain('【directions —— 你给角色的任务】')
    expect(system.content).toContain('每一轮都可以派，不是只有僵局才派')
  })

  it('用户主动交棒的那一轮，导演收到的是强刺激而不是空输入', () => {
    const messages = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      idle: true,
      doc: normalizeInput(IDLE_INPUT),
      segments: [],
      sceneSetup: setup,
      drives: [{ name: '金刚狼', drive: '把这孩子活着带出去', brief: '挡在前面' }],
    })

    const [system, user] = messages
    expect(system.content).toContain('用户主动交棒的那一轮')
    expect(system.content).toContain('只有你知道')
    expect(system.content).toContain('必须给 act')
    expect(system.content).toContain('多派几个人')
    expect(system.content).toContain('不要写成一段平静的过渡')
    // 交棒这件事只有导演知道：它不能被转达给角色
    expect(system.content).toContain('不能把这个信息转达给任何人')
    expect(user.content).toContain('用户主动交棒：这一轮他什么都没做')
    // 交棒轮的原文本身不该被当成一句台词递给导演
    expect(user.content).not.toContain('（这一轮我什么都没做。）')
  })

  it('模型不可用时只降级，不阻断整轮，并沿用上一轮的压力', async () => {
    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async () => {
        throw new Error('502')
      },
    } as unknown as LlmClient

    const { output } = await runSituationStage(client, {
      doc: normalizeInput('我听着他的吩咐不动。'),
      segments: segments(),
      sceneSetup: setup,
      cards: [],
      pcName: '我',
      storyTitle: '测试',
      previous: { pressure: '上一轮的压力', escalation: '' },
    })

    expect(output.usedModel).toBe(false)
    expect(output.events).toEqual([])
    expect(output.directions).toEqual([])
    expect(output.pressure).toBe('上一轮的压力')
  })
})

/* ------------------------------ 角色提示词 ------------------------------ */

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    characterId: 'c1',
    name: '金刚狼',
    roundIndex: 2,
    pcName: '我',
    counterpartProfile: '站在原地没动',
    presentNames: ['我', '金刚狼'],
    scene: { time: '夜里', place: '林子里', atmosphere: '风停了' },
    pressure: '狼群在二十步外压成半圆',
    escalation: '再有两三息它们就会扑上来',
    perceived: [],
    sceneLines: ['火堆只剩下一点红。'],
    heard: [],
    seen: [],
    ownThoughts: [],
    ownPriorLines: [],
    extras: [],
    pcCues: [],
    knownFacts: [],
    doesNotKnow: [],
    recalled: [],
    recap: '',
    history: [],
    card: {
      id: 'c1',
      name: '金刚狼',
      aliases: [],
      tier: 'major',
      origin: 'generated',
      canonical: false,
      franchise: '',
      source: 'material',
      mindReading: '',
      persona: {
        summary: '话少的人',
        drive: '把这个孩子活着带出去，然后回去找自己丢掉的记忆',
        speechStyle: '',
        temperament: [],
        habits: [],
        background: '',
        signature: [],
        voiceSamples: [],
        canonAnchors: [],
        boundaries: [],
        abilities: [],
        perception: [],
        hooks: [],
      },
      state: { mood: '', location: '' },
      appearsInInput: true,
      evidence: '',
    },
    ...overrides,
  }
}

describe('角色得有自己的驱动力', () => {
  const user = (extra: Partial<ContextBundle> = {}) =>
    buildRoleplayMessages({ bundle: bundle(extra), project: DEFAULT_PROJECT_SETTINGS })[1].content

  it('角色卡里的「他想要什么」会进提示词', () => {
    expect(user()).toContain('把这个孩子活着带出去')
    expect(user()).toContain('【你想要什么】')
  })

  it('没有写明驱动力时，要求模型自己推断一个并朝它行动', () => {
    const card = bundle().card
    const text = user({ card: { ...card, persona: { ...card.persona, drive: '' } } })
    expect(text).toContain('推断出你此刻最想要的东西')
  })

  it('这一轮的局面与「如果没人动会怎样」也告诉他', () => {
    const text = user()
    expect(text).toContain('狼群在二十步外压成半圆')
    expect(text).toContain('再有两三息它们就会扑上来')
  })

  it('不再强迫角色开口说话', () => {
    const [system] = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS })
    expect(system.content).not.toContain('至少要说一句话')
    expect(system.content).toContain('骨架，不是笼子')
    // 角色该去处理真正要紧的事，而不是回头指挥用户
    expect(system.content).toContain('如果真正该做的是动手，那就动手')
  })

  it('往事里也带着当时的局面，回看得到', () => {
    const history: HistoryRound[] = [
      {
        index: 1,
        time: '夜里',
        place: '林子外',
        atmosphere: '',
        pressure: '远处有狼嚎',
        escalation: '它们会顺着味道找过来',
        interludeSummary: '',
        interludeMine: '',
        pcProfile: '',
        presentNames: [],
        sceneLines: [],
        events: [],
        inner: '',
      },
    ]
    const text = user({ history })
    expect(text).toContain('远处有狼嚎')
    expect(text).toContain('它们会顺着味道找过来')
  })
})

describe('场景可以不变', () => {
  it('提示词要求它先判断变没变，没变就只回一个标记', async () => {
    const { buildSceneMessages } = await import('@/engine/prompts/scene')
    const [system] = buildSceneMessages({
      doc: normalizeInput('我推门进去。'),
      segments: [],
      pcName: '我',
      pcPersona: '测试用',
      storyTitle: '测试',
      rating: 'general',
    })

    expect(system.content).toContain('这一轮的场景变了没有')
    expect(system.content).toContain('只输出')
    expect(system.content).toContain('"unchanged": true')
    // 关键区分：场景没变 ≠ 剧情没进展
    expect(system.content).toContain('"没变"不等于"没进展"')
    expect(system.content).toContain('第一轮必须输出完整场景')
  })
})

describe('导演建议开启成人向', () => {
  const base = {
    storyTitle: '测试',
    pcName: '我',
    doc: normalizeInput('我推开门。'),
    segments: [],
    sceneSetup: setup,
    drives: [],
    rating: 'general' as const,
  }

  it('总闸开着：只告诉它两条规则，不交代客户端怎么处理', () => {
    const [system] = buildSituationMessages({ ...base, allowR18: true })
    expect(system.content).toContain('建议用户开启成人向')
    expect(system.content).toContain('只有这一轮标着【本轮分级：成人向】时')
    // 界面上的事它看不到，也不该操心
    expect(system.content).not.toContain('客户端')
    expect(system.content).not.toContain('自动勾')
    expect(system.content).not.toContain('取消勾选')
  })

  it('总闸关着：它的世界里根本没有这回事', () => {
    const [system] = buildSituationMessages({ ...base, allowR18: false })
    expect(system.content).not.toContain('建议用户开启成人向')
    // 输出格式里那个字段仍然在 —— 它是 SYSTEM 的一部分，无条件渲染，
    // 为的是保持字节一致（prompt cache）。没有说明文字，它就是个普通字段名。
    expect(system.content).not.toContain('【R18】')
  })
})
