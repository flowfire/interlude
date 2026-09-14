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

  it('演员可以省主语，但宾语必须写清楚', () => {
    // 场上不止一个人时，"把手按住"读不出按住了谁。
    // 格式要求是"永远都在"的那部分，所以写在 SYSTEM 里（不吃分级、可以缓存）
    const general = buildRoleplayMessages({
      bundle: bundle(),
      project: DEFAULT_PROJECT_SETTINGS,
      rating: 'general',
    })
    // beats 是给用户看的：自己用第三人称（或省主语），pc 用「你」
    expect(general[0].content).toContain('面对用户讲故事')
    expect(general[0].content).toContain('用户扮演的那个人用「你」')
    expect(general[0].content).toContain('克拉克爱你')
    expect(general[0].content).toContain('宾语必须写清楚')
    expect(general[0].content).toContain('他的手')
    // 输出格式的示范也在 SYSTEM 里：那条涉及别人的动作，宾语是明确的
    expect(general[0].content).toContain('按住了他的手腕')
  })

  it('普通成人向（没开「让导演推进」）时，演员也知道要写直白', () => {
    // 这条曾经只写在导演那边 —— 导演被告知"文字要直白、该写什么器官就写什么器官"，
    // 而演员这边只有一句"可以让挑逗更直接"，于是普通成人向下演员写得含糊。
    const messages = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'r18' })
    const user = messages[1].content

    expect(user).toContain('用词要直白')
    expect(user).toContain('鸡巴')
    expect(user).toContain('阴唇')
    expect(user).toContain('别含糊')
    // 关键：把"推进慢"和"写得虚"分开 —— 否则演员会以为普通模式=含蓄
    expect(user).toContain('慢不等于虚')
    // 但**不**该把"必须推进"塞进来，那是「让导演推进」的事
    expect(user).not.toContain('【让导演推进')
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

  it('「让导演推进」是叠在成人向之上的一层，两条都齐了才生效', () => {
    const base = {
      bundle: bundle(),
      project: DEFAULT_PROJECT_SETTINGS,
    }

    const off = buildRoleplayMessages({ ...base, rating: 'r18' })[1].content
    expect(off).toContain('成人向')
    expect(off).not.toContain('【让导演推进】')

    const on = buildRoleplayMessages({ ...base, rating: 'r18', direct: true })[1].content
    expect(on).toContain('让导演推进 —— 直接演性爱，不要绕')
    expect(on).toContain('别再拖了')
    // 导演铺了台阶，演员别自己踩刹车
    expect(on).toContain('导演已经替你把台阶铺好了')
    // 写到什么程度必须说清楚：光给词表不够，得给密度示范
    expect(on).toContain('这些都要明明白白写出来')
    expect(on).toContain('不要跳步')
    expect(on).toContain('回避就是没完成工作')
    expect(on).toContain('照着这个密度写')
    expect(on).toContain('写的是套话，不是这两个人')
    // 不许用含糊说法糊过去（只允许出现在反例清单里）。
    // 普通成人向和「让导演推进」各有一份反例清单，所以最多两处 ——
    // 关键是它们**只能出现在"不许用"的语境里**。
    expect(on).toContain('不许用这些糊过去')
    expect((on.match(/融为一体/g) ?? []).length).toBeLessThanOrEqual(2)
    // 露骨的词要明确告知，让模型知道该用
    expect(on).toContain('操、肏、鸡巴、逼')
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
    expect(general).not.toContain('【让导演推进】')
  })

  it('导演也会收到「让导演推进」，落在节奏与用词上', () => {
    const base = {
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上了。'),
      segments: [],
      sceneSetup: setup(),
      drives: [],
      rating: 'general' as const,
    }

    const off = buildSituationMessages({ ...base, rating: 'r18' })[0].content
    expect(off).toContain('成人向')
    // 没开「让导演推进」时，只有"什么时候填 routes"那句限定里会提到它
    expect(off).not.toContain('【让导演推进】')

    const on = buildSituationMessages({
      ...base,
      rating: 'r18',
      direct: true,
      r18Streak: 1,
      directStreak: 1,
    })[0].content

    // 「让导演推进」：往做爱上推，但压缩过程而不是跳过逻辑
    expect(on).toContain('【让导演推进】')
    expect(on).toContain('这一轮的调度都朝这个方向走')
    expect(on).toContain('压缩过程，不跳过逻辑')
    expect(on).toContain('怎么做由你决定')

    // backstory 写的是"两个人之间"，不是这个人的来历
    expect(on).toContain('把这一轮之前的空白替他写掉')
    expect(on).toContain('不是这个人的来历')

    // 光给词表不够，得给密度示范
    expect(on).toContain('这些都要明明白白写出来')
    expect(on).toContain('不要跳步')
    expect(on).toContain('一段合格的 act')
    expect(on).toContain('这类说法糊过去')

    // 那一堆含糊说法只能出现在反例里
    const directHint = on.slice(on.indexOf('【让导演推进'))
    expect(directHint).not.toContain('那件事')
    expect((directHint.match(/融为一体/g) ?? []).length).toBeLessThanOrEqual(2)

    // 露骨的词要明确告知，让模型知道该用
    expect(on).toContain('操、肏、鸡巴、逼')
    expect(on).toContain('你怎么说话，演员就怎么说话')

    // 用户要的是期待感，不需要提前指定
    expect(on).toContain('他不知道会看到什么')

    // 没勾 R18 时它不该出现
    const general = buildSituationMessages({ ...base, direct: true })[0].content
    expect(general).not.toContain('【让导演推进】')
  })

  it('用词必须参考色情小说 —— 不许留临床/学术的说法', () => {
    const base = {
      storyTitle: '测试',
      pcName: '我',
      doc: normalizeInput('我把门关上了。'),
      segments: [],
      sceneSetup: setup(),
      drives: [],
      rating: 'r18' as const,
    }
    const director = buildSituationMessages({ ...base, direct: true, r18Streak: 3, directStreak: 3 })[0].content
    const actor = buildRoleplayMessages({ bundle: bundle(), project: DEFAULT_PROJECT_SETTINGS, rating: 'r18', direct: true })[1]
      .content

    // 勾了这个开关，用词就得像色情小说 —— 这些是必须出现的
    for (const text of [director, actor]) {
      expect(text).toContain('做爱')
      expect(text).toContain('鸡巴')
      expect(text).toContain('逼')
    }

    // 而这些是临床/学术说法，一个都不许留（只看成人向那几段 ——
    // SYSTEM 前面另有一处与性无关的「放了三天的那件事」）
    const directorR18 = director.slice(director.indexOf('【本轮分级：成人向'))
    for (const word of ['性内容', '性张力', '性器官', '性行为', '通向性', '性相关', '那件事']) {
      expect(directorR18).not.toContain(word)
      expect(actor).not.toContain(word)
    }
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

  it('只加勾「让导演推进」也算改动', () => {
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
