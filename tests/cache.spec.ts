import { describe, expect, it } from 'vitest'
import { SEPARATOR, buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { stableCharacterId } from '@/engine/stages/s3-cast'
import type { CharacterCard, ContextBundle } from '@/types/character'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 提示词缓存友好性。
 *
 * 同一轮里每个角色都是独立的一次请求，但它们的提示词前缀应该尽量一样：
 * system 完全通用，user 的前半段是所有在场角色共享的背景。
 * 这样服务端的前缀缓存（DeepSeek / OpenAI 的 prompt caching）能命中，
 * 而且角色越多、前文越长，省得越多。
 */
function card(name: string, mask: string): CharacterCard {
  return {
    id: stableCharacterId(name),
    name,
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: mask,
      speechStyle: `${mask}的说话方式`,
      temperament: [mask],
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
  }
}

function bundleFor(name: string, mask: string, recap: string): ContextBundle {
  return {
    characterId: stableCharacterId(name),
    name,
    card: card(name, mask),
    pcName: '我',
    counterpartProfile: '站在门口没动',
    presentNames: ['我', '林砚', '阿七'],
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
    recap,
  }
}

const RECAP = '第 1 轮 · 城南茶馆：他把伞靠在门边，说了一句「坐吧」。'

describe('提示词缓存友好', () => {
  it('同一轮里，所有角色的 system 完全相同', () => {
    const a = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })
    const b = buildRoleplayMessages({
      bundle: bundleFor('阿七', '话多', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })

    expect(a[0].content).toBe(b[0].content)
    expect(a[0].role).toBe('system')
  })

  it('system 里没有任何角色专属内容', () => {
    const [system] = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })

    expect(system.content).not.toContain('林砚')
    expect(system.content).not.toContain('话少')
    expect(system.content).not.toContain(RECAP)
  })

  it('system 只由项目设置决定，跨轮也保持一致', () => {
    const first = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })
    const later = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', '第 2 轮：他走了。'),
      project: DEFAULT_PROJECT_SETTINGS,
    })

    expect(first[0].content).toBe(later[0].content)
  })

  it('不同角色之间，user 在分隔线之前的部分完全相同', () => {
    const a = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content
    const b = buildRoleplayMessages({
      bundle: bundleFor('阿七', '话多', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    const prefixA = a.slice(0, a.indexOf(SEPARATOR))
    const prefixB = b.slice(0, b.indexOf(SEPARATOR))

    expect(prefixA).toBe(prefixB)
    expect(prefixA).toContain(RECAP)
    expect(prefixA).toContain('城南茶馆')
  })

  it('共享内容排在角色专属内容之前 —— 前缀越长越省，所以长的放前面', () => {
    const user = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    const recapAt = user.indexOf(RECAP)
    const dividerAt = user.indexOf(SEPARATOR)
    const personalAt = user.indexOf('【你扮演谁】')

    expect(recapAt).toBeGreaterThanOrEqual(0)
    expect(dividerAt).toBeGreaterThan(recapAt)
    expect(personalAt).toBeGreaterThan(dividerAt)
  })

  it('分隔线之后的内容才是每个角色不一样的', () => {
    const a = buildRoleplayMessages({
      bundle: bundleFor('林砚', '话少', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content
    const b = buildRoleplayMessages({
      bundle: bundleFor('阿七', '话多', RECAP),
      project: DEFAULT_PROJECT_SETTINGS,
    })[1].content

    const suffixA = a.slice(a.indexOf(SEPARATOR))
    const suffixB = b.slice(b.indexOf(SEPARATOR))

    expect(suffixA).not.toBe(suffixB)
    expect(suffixA).toContain('林砚')
    expect(suffixB).toContain('阿七')
  })
})
