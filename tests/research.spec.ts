import { describe, expect, it, vi } from 'vitest'
import { normalizeCastResult, runCastStage, stableCharacterId } from '@/engine/stages/s3-cast'
import { lookupWiki } from '@/engine/research/wiki'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import { buildCastMessages } from '@/engine/prompts/cast'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import type { CharacterCard, ContextBundle, RawCastResult } from '@/types/character'
import type { WikiLookup } from '@/engine/research/wiki'
import { DEFAULT_LLM_SETTINGS, DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

const WOLVERINE: WikiLookup = {
  title: '金刚狼',
  extract: '金刚狼（Wolverine）是漫威漫画旗下的超级英雄，本名罗根，拥有自愈能力与艾德曼合金爪。',
  url: 'https://zh.wikipedia.org/wiki/金刚狼',
  lang: 'zh',
}

function rawWolverine(): RawCastResult {
  return {
    characters: [
      {
        name: '金刚狼',
        tier: 'major',
        canonical: true,
        franchise: '《X战警》',
        summary: '一个活得太久、什么都不太在乎的变种人',
        speechStyle: '句子短，常用反问和带刺的玩笑，很少解释自己',
        temperament: ['嘴硬', '对弱者笨拙地耐心'],
        habits: ['动手前先活动一下脖子'],
        background: '和「我」在旅馆门口撞上',
        signature: ['动手前先活动一下脖子', '嘴上嫌麻烦但答应的事一定做到', '雪茄'],
        voiceSamples: ['「少废话。」', '「我不太喜欢别人碰我的东西。」'],
        canonAnchors: ['自愈能力很强，但受伤依然会痛', '艾德曼合金骨架'],
        boundaries: ['不会对小孩下手', '不会主动谈起自己的过去'],
        mood: '警惕但不紧张',
        location: '旅馆台阶上',
        appearsInInput: true,
        evidence: '你的知识',
      },
    ],
  } as unknown as RawCastResult
}

describe('资料阶梯', () => {
  it('查到维基资料时，卡标记为 wiki 来源并留下可追溯的资料摘要', () => {
    const cards = normalizeCastResult(rawWolverine(), '我', { 金刚狼: WOLVERINE })
    const card = cards[0]

    expect(card.source).toBe('wiki')
    expect(card.canonical).toBe(true)
    expect(card.franchise).toBe('《X战警》')
    expect(card.researchNote).toContain('中文维基')
    expect(card.researchNote).toContain('自愈能力')

    // 这几项正是防止知名角色出戏的东西
    expect(card.persona.signature.length).toBeGreaterThanOrEqual(3)
    expect(card.persona.voiceSamples).toHaveLength(2)
    expect(card.persona.canonAnchors.length).toBeGreaterThan(0)
    expect(card.persona.boundaries.length).toBeGreaterThan(0)
  })

  it('没查到资料但认得出是知名角色时，来源记为模型知识', () => {
    const cards = normalizeCastResult(rawWolverine(), '我')
    expect(cards[0].source).toBe('model')
    expect(cards[0].canonical).toBe(true)
    expect(cards[0].researchNote).toBeUndefined()
  })

  it('原创角色记为「仅素材」', () => {
    const raw = {
      characters: [{ name: '阿七', canonical: false, summary: '柜台后面擦杯子的人' }],
    } as unknown as RawCastResult

    const cards = normalizeCastResult(raw, '我')
    expect(cards[0].source).toBe('material')
    expect(cards[0].canonical).toBe(false)
  })

  it('维基查不到时静默返回 null，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')))
    await expect(lookupWiki('金刚狼', 100)).resolves.toBeNull()
    vi.unstubAllGlobals()
  })

  it('维基返回 404 时也返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(lookupWiki('不存在的条目', 100)).resolves.toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('资料会进入提示词', () => {
  it('开启资料检索时，查到的东西会体现在角色卡上', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          title: '金刚狼',
          extract: '金刚狼是漫威漫画旗下的超级英雄，拥有自愈能力与艾德曼合金爪。',
          type: 'standard',
          content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/金刚狼' } },
        }),
      }),
    )

    const client = {
      settings: { ...DEFAULT_LLM_SETTINGS, maxConcurrency: 4 },
      isConfigured: true,
      chat: async () => {
        throw new Error('未使用')
      },
      chatJson: async (_m: unknown, options: { parse: (raw: unknown) => unknown }) => {
        const raw = {
          characters: [
            {
              name: '金刚狼',
              canonical: true,
              franchise: '《X战警》',
              summary: '活得够久，所以什么都不太在乎',
              signature: ['动手前先活动一下脖子'],
              voiceSamples: ['「少废话。」'],
            },
          ],
        }
        return {
          data: options.parse(raw),
          result: {
            content: '{}',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: 'fake',
            ms: 1,
            retries: 0,
          },
        }
      },
    }

    const { output } = await runCastStage(client as never, {
      doc: normalizeInput('（我遇到了金刚狼）'),
      segments: [],
      project: { ...DEFAULT_PROJECT_SETTINGS, researchEnabled: true },
      present: [{ name: '金刚狼', role: '台阶上', brief: '擦爪子', kind: 'character', active: true }],
    })

    expect(output.researchedCount).toBe(1)
    expect(output.characters[0].source).toBe('wiki')
    expect(output.characters[0].researchNote).toContain('自愈能力')

    vi.unstubAllGlobals()
  })

  it('查到的资料被塞进阵容提示词', () => {
    const messages = buildCastMessages({
      doc: normalizeInput('（我遇到了金刚狼）'),
      segments: [],
      pcName: '我',
      storyTitle: '测试',
      present: [
        { name: '金刚狼', role: '台阶上', brief: '擦爪子', kind: 'character', active: true },
        { name: '前台老头', role: '前台', brief: '打瞌睡', kind: 'extra', active: false },
      ],
      research: { 金刚狼: WOLVERINE },
    })

    const user = messages[1].content
    expect(user).toContain('中文维基')
    expect(user).toContain('自愈能力')
    // 没有资料的人要明确告诉模型"没查到"，好让它走 B 类写法
    expect(user).toContain('没有查到外部资料')
  })

  it('角色提示词里出现标志性特征、示例台词和硬约束', () => {
    const card: CharacterCard = normalizeCastResult(rawWolverine(), '我', { 金刚狼: WOLVERINE })[0]
    const bundle: ContextBundle = {
      characterId: stableCharacterId('金刚狼'),
      name: '金刚狼',
      card,
      pcName: '我',
      counterpartProfile: '站在门口没动',
      presentNames: ['我', '金刚狼'],
      scene: { time: '傍晚', place: '旅馆门口', atmosphere: '雨刚停' },
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
    }

    const messages = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })
    const system = messages[0].content

    expect(system).toContain('动手前先活动一下脖子')
    expect(system).toContain('「少废话。」')
    expect(system).toContain('不会对小孩下手')
    expect(system).toContain('《X战警》')
    expect(system).toContain('标志性特征')
  })
})
