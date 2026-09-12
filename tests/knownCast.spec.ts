import { describe, expect, it } from 'vitest'
import { mergeIntoKnownCast } from '@/engine/stages/s2-scene'
import { resolveKnownName, toKnownCast } from '@/engine/memory/library'
import { buildSegmenterMessages, renderKnownCast } from '@/engine/prompts/segmenter'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import { stableCharacterId } from '@/engine/stages/s3-cast'
import type { CharacterCard, KnownCastEntry } from '@/types/character'
import type { ScenePresent } from '@/types/scene'

const WOLVERINE: KnownCastEntry = { name: '金刚狼', aliases: ['罗根'], brief: '台阶上擦爪子的人' }

function card(name: string, aliases: string[] = []): CharacterCard {
  return {
    id: stableCharacterId(name),
    name,
    aliases,
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '一句话简介',
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
  }
}

function present(name: string): ScenePresent {
  return { name, role: '', brief: '', kind: 'character', active: true }
}

/**
 * 用户写「我跟着前面那个人」时，「前面的人」指的是上一轮出场的金刚狼。
 * 如果引擎不结合前文，就会凭空多出一个叫「前面的人」的人设。
 */
describe('指代词要结合前文解析，不能凭空多出角色', () => {
  it('能按别名匹配回已知角色', () => {
    expect(resolveKnownName('罗根', [WOLVERINE])?.name).toBe('金刚狼')
    expect(resolveKnownName('金刚狼', [WOLVERINE])?.name).toBe('金刚狼')
    expect(resolveKnownName('完全不认识的人', [WOLVERINE])).toBeNull()
  })

  it('present 里用了别名，会被归并回真名', () => {
    expect(mergeIntoKnownCast([present('罗根')], [WOLVERINE]).map((item) => item.name)).toEqual(['金刚狼'])
  })

  it('只有一个已知角色时，明显的指代会被归并过去', () => {
    for (const pronoun of ['前面的人', '那个人', '对方', '他']) {
      expect(mergeIntoKnownCast([present(pronoun)], [WOLVERINE]).map((item) => item.name)).toEqual(['金刚狼'])
    }
  })

  it('有多个已知角色时，不猜指代 —— 原样留着，别猜错人', () => {
    const many: KnownCastEntry[] = [
      { name: '金刚狼', aliases: [], brief: '' },
      { name: '阿七', aliases: [], brief: '' },
    ]
    expect(mergeIntoKnownCast([present('前面的人')], many).map((item) => item.name)).toEqual(['前面的人'])
  })

  it('归并之后不会出现同一个人的两张卡', () => {
    expect(mergeIntoKnownCast([present('金刚狼'), present('罗根')], [WOLVERINE]).map((item) => item.name)).toEqual([
      '金刚狼',
    ])
  })

  it('没有已知角色时（第一轮）原样放行', () => {
    expect(mergeIntoKnownCast([present('前面的人')], []).map((item) => item.name)).toEqual(['前面的人'])
  })

  it('完全不认识的新角色不受影响', () => {
    expect(mergeIntoKnownCast([present('阿七')], [WOLVERINE]).map((item) => item.name)).toEqual(['阿七'])
  })

  it('角色库能压成给提示词用的名单', () => {
    const known = toKnownCast({ a: card('金刚狼', ['罗根']), b: card('阿七') })
    expect(known.map((entry) => entry.name).sort()).toEqual(['金刚狼', '阿七'])
    expect(known.find((entry) => entry.name === '金刚狼')?.aliases).toEqual(['罗根'])
  })
})

describe('已知角色名单会进入三个阶段的提示词', () => {
  it('渲染名单时会带上别名与简介', () => {
    const text = renderKnownCast([WOLVERINE])
    expect(text).toContain('金刚狼')
    expect(text).toContain('罗根')
    expect(text).toContain('台阶上擦爪子的人')
  })

  it('第一轮时明确说「还没有已知角色」', () => {
    expect(renderKnownCast([])).toContain('还没有已知角色')
    expect(renderKnownCast(undefined)).toContain('还没有已知角色')
  })

  it('拆解提示词里带上了已知角色，并要求把指代写成真名', () => {
    const messages = buildSegmenterMessages({
      doc: normalizeInput('我跟着前面那个人'),
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      freedomLevel: 'medium',
      knownCast: [WOLVERINE],
    })
    const user = messages[1].content
    expect(user).toContain('金刚狼')
    expect(messages[0].content).toContain('指代')
  })

  it('场景构建提示词里带上了已知角色，并禁止把称呼当成人名', () => {
    const messages = buildSceneMessages({
      doc: normalizeInput('我跟着前面那个人'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      knownCast: [WOLVERINE],
    })
    const user = messages[1].content
    expect(user).toContain('金刚狼')
    expect(user).toContain('不要把「前面的人」这种称呼当成一个新角色')
  })
})
