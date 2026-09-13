import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store/appStore'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { buildExposureMessages } from '@/engine/prompts/exposure'
import { buildSituationMessages } from '@/engine/prompts/situation'
import { buildPerceiveMessages } from '@/engine/prompts/perceive'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import { stableCharacterId } from '@/engine/stages/s3-cast'
import type { CharacterCard, ContextBundle } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import type { ContentRating, Round } from '@/types/step'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'
import { isRoundDraftDirty } from '@/utils/roundDraft'

function card(): CharacterCard {
  return {
    id: stableCharacterId('林砚'),
    name: '林砚',
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '话少的人',
      drive: '',
      speechStyle: '句子很短',
      temperament: ['克制'],
      habits: ['答话前先停半拍'],
      background: '和「我」有旧账',
      signature: ['答话前先停半拍'],
      voiceSamples: ['「嗯。」'],
      canonAnchors: [],
      boundaries: ['不会主动解释自己的动机'],
      abilities: [],
      perception: [],
      hooks: [],
    },
    state: { mood: '戒备', location: '茶馆' },
    appearsInInput: true,
    evidence: '素材里他答了一个字',
  }
}

function bundle(): ContextBundle {
  return {
    characterId: stableCharacterId('林砚'),
    name: '林砚',
    card: card(),
    pcName: '我',
    counterpartProfile: '站在门口没动',
    presentNames: ['我', '林砚'],
    scene: { time: '傍晚', place: '城南茶馆', atmosphere: '雨刚停' },
    perceived: [],
    sceneLines: [],
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
    pressure: '',
    escalation: '',
    roundIndex: 2,
    history: [],
  }
}

function setup(): SceneSetup {
  return {
    inputMode: 'dialogue',
    time: '傍晚',
    place: '城南茶馆',
    atmosphere: '雨刚停',
    opening: [],
    situation: '你推门进来',
    pcProfile: '外套湿了一片',
    present: [{ name: '林砚', role: '靠里坐着', brief: '在喝茶', kind: 'character', active: true }],
    establishedBeats: [],
    usedModel: true,
  }
}

describe('R18 分级', () => {
  beforeEach(() => {
    useAppStore.getState().resetWorkspace()
  })

  it('分级跟着轮次走：勾了就是 r18，没勾默认 general', () => {
    const rated = useAppStore.getState().newRound('第一轮', 'r18')
    const plain = useAppStore.getState().newRound('第二轮')

    expect(rated.rating).toBe('r18')
    expect(plain.rating).toBe('general')

    // 两轮各存各的，互不影响
    const rounds = useAppStore.getState().rounds
    expect(rounds[0].rating).toBe('r18')
    expect(rounds[1].rating).toBe('general')
  })

  it('可以让某一轮重新选择分级', () => {
    const round = useAppStore.getState().newRound('第一轮')
    expect(round.rating).toBe('general')

    useAppStore.getState().setRoundRating(round.id, 'r18')
    expect(useAppStore.getState().rounds[0].rating).toBe('r18')
  })

  it('勾选后，角色提示词里出现成人向段落，并且写死了人设底线', () => {
    const messages = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'r18' })
    const user = messages[1].content

    expect(user).toContain('成人向')
    // 三条底线缺一不可
    expect(user).toContain('性格不能变')
    expect(user).toContain('你会做的事')
    expect(user).toContain('不要一步到位')
  })

  it('不勾选时，提示词里完全没有成人向内容', () => {
    const messages = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'general' })
    expect(messages[0].content).not.toContain('成人向')
    expect(messages[1].content).not.toContain('成人向')
    expect(messages[1].content).not.toContain('身体距离')
  })

  it('分级只影响 user，system 永远逐字节相同（前缀缓存）', () => {
    const r18 = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'r18' })
    const general = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'general' })

    expect(r18[0].content).toBe(general[0].content)
    expect(r18[0].content).not.toContain('成人向')
    expect(r18[0].content).not.toContain('自由度')
  })

  it('「快速入戏」是叠在成人向之上的一层，两条都齐了才生效', () => {
    const base = {
      bundle: bundle(),
      project: DEFAULT_PROJECT_SETTINGS,
    }

    const off = buildRoleplayMessages({ ...base, rating: 'r18' })[1].content
    expect(off).toContain('成人向')
    expect(off).not.toContain('快速入戏')

    const on = buildRoleplayMessages({ ...base, rating: 'r18', direct: true })[1].content
    expect(on).toContain('快速入戏 —— 直接演性爱，不要绕')
    expect(on).toContain('别再拖了')
    // 导演铺了台阶，演员别自己踩刹车
    expect(on).toContain('导演已经替你把台阶铺好了')
    // 写到什么程度必须说清楚：光给词表不够，得给密度示范
    expect(on).toContain('性器官要写出来')
    expect(on).toContain('不要跳步')
    expect(on).toContain('回避就是没完成工作')
    expect(on).toContain('照着这个密度写')
    expect(on).toContain('写的是套话，不是这两个人')
    // 不许用含糊说法糊过去（只允许出现在反例清单里）
    expect(on).toContain('不许用这些糊过去')
    expect((on.match(/融为一体/g) ?? []).length).toBe(1)
    // 露骨的词要明确告知，让模型知道该用
    expect(on).toContain('操、肏、屌、逼')
    expect(on).toContain('回避本身就是出戏')
    // 指令自己的措辞也不能回避 —— 它会原样传导成导演的偏好
    expect(on).not.toContain('那件事')
    // 用户要的是期待感，不需要提前指定
    expect(on).toContain('具体怎么演由你决定')
    // 性格的模糊地带往成人向解释，但写死的底线不在此列
    expect(on).toContain('性格上的模糊地带，往成人向解释')
    expect(on).toContain('写死的底线')
    // 底线一条没松
    expect(on).toContain('三条底线一条没松')

    // 没勾 R18 时它不该出现
    const general = buildRoleplayMessages({ ...base, rating: 'general', direct: true })[1].content
    expect(general).not.toContain('快速入戏')
  })

  it('导演也会收到「快速入戏」，落在节奏与用词上', () => {
    const base = {
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上。'),
      segments: [],
      sceneSetup: setup(),
      drives: [],
    }

    const on = buildSituationMessages({ ...base, rating: 'r18', direct: true })[0].content
    expect(on).toContain('【快速入戏】')
    expect(on).toContain('尽快看到他们做爱')
    // act 要写明确的性进展，而不是含糊带过
    expect(on).toContain('性器官要写出来')
    expect(on).toContain('过程要写出来')
    // 用词直白（用户要求：有必要就必须明确告知）
    expect(on).toContain('操、肏、屌、逼')
    expect(on).toContain('不许用这些糊过去')
    // 理由必须建立在已经发生过的事上，不是随便挑一个转折点
    expect(on).toContain('为什么是此刻')
    expect(on).toContain('放哪儿都成立的话')
    // 这一轮的第一要务是推进成人向，不是"随便推进一点剧情"
    expect(on).toContain('第一要务')
    expect(on).toContain('第一要务就是这件事')
    expect(on).toContain('一样都不许跑题')
    // reason 必须是"性内容能往前一步"的理由，不能是跑题的剧情转折
    expect(on).toContain('为什么是此刻他们能往前一步')
    expect(on).toContain('都不算理由')
    // events 也不许写跟性无关的东西
    expect(on).toContain('不要拿一场跟性无关的冲突来"推进剧情"')
    // 推不动的时候有第三条路：不硬拗、不抗命，而是给用户几条可选方向
    expect(on).toContain('把选择权交回用户')
    expect(on).toContain('routes 是**给用户选的开场**')
    expect(on).toContain('让他在你这里养伤')
    // 光给词表不够，得给密度示范
    expect(on).toContain('性器官要写出来')
    expect(on).toContain('不许跳步')
    expect(on).toContain('一段合格的 act**（照这个密度写')
    expect(on).toContain('回避就是没完成工作')
    // 快速入戏那一段里，「那件事」这类回避指代一次都不许出现
    const directHint = on.slice(on.indexOf('【快速入戏'))
    expect(directHint).not.toContain('那件事')
    // 含糊说法只允许出现在"不许用这些"的反例清单里
    expect((directHint.match(/融为一体/g) ?? []).length).toBe(1)
    expect(directHint).toContain('不许用这些糊过去')
    // 快速模式和普通成人向的真正区别：允许把过程写成已经发生过的背景
    expect(on).toContain('可以把性写成「已经发生过的背景」')
    expect(on).toContain('这是快速模式和普通成人向最大的区别')
    expect(on).toContain('模棱两可的判断一律往更能导向做爱的方向选')
    // 场景不配合时有办法：把它改造成通向性的场面
    expect(on).toContain('怎么把「看起来不相干」的场景改造成通向性的场面')
    expect(on).toContain('一个陌生人站在门口')
    // 用户勾这个是为了保留期待感，不是为了让导演去猜他的口味
    expect(on).toContain('具体怎么做由你决定')
    expect(on).toContain('不要停下来揣测')
    // 压缩的是过程，不是逻辑：既不能跳戏，也不能拖
    expect(on).toContain('压缩过程，不是跳过逻辑')
    expect(on).toContain('这种断裂的写法不行')
    expect(on).toContain('跨度可以极大')
    expect(on).toContain('一样都不许跑题')
    // 判定标准要能量化，否则导演不知道做到没有
    expect(on).toContain('有没有出现身体上的新进展')
    // 红线不松
    expect(on).toContain('用户扮演的角色一个字都不能替他写')

    // 非快速入戏的成人向轮次里没有那一段指令。注意计数器说明里会提到
    // 「其中 N 轮勾了快速入戏」，所以只断言指令段本身不在。
    const off = buildSituationMessages({ ...base, rating: 'r18' })[0].content
    expect(off).not.toContain('【快速入戏')
  })

  it('成人向那一轮，用户身上的细节更容易被注意到', () => {
    const base = {
      pcName: '我',
      actors: [{ name: '林砚', position: '桌边', senses: [], mindReading: '' }],
      candidates: [],
    }

    const r18 = buildPerceiveMessages({ ...base, rating: 'r18' })[0].content
    expect(r18).toContain('用户身上的细节更容易被注意到')
    expect(r18).toContain('不要轻易判 missed')
    // 放宽的是注意力阈值，不是空间关系
    expect(r18).toContain('背对着、离得很远、在另一个房间')

    const general = buildPerceiveMessages({ ...base, rating: 'general' })[0].content
    expect(general).not.toContain('不要轻易判 missed')
  })

  it('导演也会收到分级 —— 他能直接指派角色做什么', () => {
    const messages = buildSituationMessages({
      storyTitle: '测试',
      pcName: '我',
      rating: 'r18',
      doc: normalizeInput('我把门关上。'),
      segments: [],
      sceneSetup: {
        inputMode: 'dialogue',
        time: '夜里',
        place: '客栈房间',
        atmosphere: '只有一盏灯',
        opening: [],
        situation: '门关上了。',
        pcProfile: '站在门口',
        present: [{ name: '林砚', role: '坐在桌边', brief: '看着你', kind: 'character', active: true }],
        establishedBeats: [],
        usedModel: true,
      },
      drives: [{ name: '林砚', drive: '想让你自己开口', brief: '坐在桌边' }],
    })

    expect(messages[0].content).toContain('成人向')
    expect(messages[0].content).toContain('身体边界是用户的，不归你决定')
  })

  it('场景构建也会收到分级，但只放氛围、不动人物处境', () => {
    const messages = buildSceneMessages({
      doc: normalizeInput('我推门进来'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      rating: 'r18',
    })
    const user = messages[1].content

    expect(user).toContain('成人向')
    expect(user).toContain('不要为了营造气氛而改变人物的处境')
  })

  it('外化也收到分级，但强调泄漏程度仍由人设决定', () => {
    const messages = buildExposureMessages({
      pcName: '我',
      pcPersona: '沈栖，习惯把情绪压住',
      innerLines: ['我有点慌'],
      sceneSetup: setup(),
      presentNames: ['我', '林砚'],
      storyTitle: '测试',
      rating: 'r18',
    })
    const user = messages[1].content

    expect(user).toContain('成人向')
    expect(user).toContain('泄漏程度仍然由人设决定')
  })
})

describe('编辑一轮时，「分级变了」也算改动', () => {
  const makeRound = (userInput: string, rating?: ContentRating): Round => ({
    id: 'r1',
    sessionId: 's1',
    index: 1,
    userInput,
    rating,
    stepIds: [],
    rootStepIds: [],
    status: 'done',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  })

  it('内容和分级都没动 → 不算改动', () => {
    expect(isRoundDraftDirty(makeRound('abc', 'general'), { userInput: 'abc', rating: 'general', direct: false })).toBe(false)
  })

  it('内容一个字没改，只把 R18 勾上 → 也算改动', () => {
    expect(isRoundDraftDirty(makeRound('abc', 'general'), { userInput: 'abc', rating: 'r18', direct: false })).toBe(true)
  })

  it('反过来，取消 R18 同样算改动', () => {
    expect(isRoundDraftDirty(makeRound('abc', 'r18'), { userInput: 'abc', rating: 'general', direct: false })).toBe(true)
  })

  it('只改了内容也算改动', () => {
    expect(isRoundDraftDirty(makeRound('abc'), { userInput: 'abd', rating: 'general', direct: false })).toBe(true)
  })

  it('只有首尾空白不同 → 不算改动', () => {
    expect(isRoundDraftDirty(makeRound('abc'), { userInput: '  abc\n', rating: 'general', direct: false })).toBe(false)
  })

  it('只加勾「快速入戏」也算改动', () => {
    expect(
      isRoundDraftDirty(makeRound('abc', 'r18'), { userInput: 'abc', rating: 'r18', direct: false }),
    ).toBe(false)
    expect(
      isRoundDraftDirty(makeRound('abc', 'r18'), { userInput: 'abc', rating: 'r18', direct: true }),
    ).toBe(true)
    // 反过来取消也算
    const on = { ...makeRound('abc', 'r18'), direct: true }
    expect(isRoundDraftDirty(on, { userInput: 'abc', rating: 'r18', direct: false })).toBe(true)
  })

  it('旧数据没有 rating 字段时按 general 处理', () => {
    const legacy = makeRound('abc')
    delete (legacy as { rating?: ContentRating }).rating
    expect(isRoundDraftDirty(legacy, { userInput: 'abc', rating: 'general', direct: false })).toBe(false)
    expect(isRoundDraftDirty(legacy, { userInput: 'abc', rating: 'r18', direct: false })).toBe(true)
  })
})
