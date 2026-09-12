import { describe, expect, it } from 'vitest'
import { buildSceneMessages } from '@/engine/prompts/scene'
import { buildRoleplayMessages } from '@/engine/prompts/roleplay'
import { buildContextBundle } from '@/engine/stages/s4-context'
import { normalizeInput } from '@/engine/stages/s0-normalize'
import type { CharacterCard, ContextBundle, HistoryRound } from '@/types/character'
import type { SceneSetup } from '@/types/scene'
import { DEFAULT_PROJECT_SETTINGS } from '@/types/settings'

/**
 * 时间跳跃的补全。
 *
 * 用户写「三天后」，这三天不是冻结的 —— 别人照样在过日子。
 * 补全的形态：一段所有人都知道的 summary + 每人各自的一条。
 */

function card(name: string): CharacterCard {
  return {
    id: `id-${name}`,
    name,
    aliases: [],
    tier: 'major',
    origin: 'generated',
    canonical: false,
    franchise: '',
    source: 'material',
    mindReading: '',
    persona: {
      summary: '',
      drive: '',
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

function setup(): SceneSetup {
  return {
    inputMode: 'outline',
    time: '三天后',
    place: '城南茶馆',
    atmosphere: '和三天前一样',
    opening: ['门还是那扇门。'],
    situation: '你回来了。',
    pcProfile: '站在门口。',
    present: [
      { name: '林砚', role: '老板', brief: '在擦杯子', kind: 'character', active: true },
      { name: '阿七', role: '伙计', brief: '在后院', kind: 'character', active: true },
    ],
    establishedBeats: [],
    interlude: {
      summary: '这三天茶馆照常开着，只是靠里那桌一直空着。',
      each: [
        { who: '林砚', what: '他每天照常开门，把那半盏茶的位置留着没动。' },
        { who: '阿七', what: '他把后院的柴劈完了，谁也没提那天晚上的事。' },
      ],
    },
    usedModel: true,
  }
}

describe('时间跳跃补全', () => {
  it('开关打开时才要求补全，关掉时明确不许补', () => {
    const on = buildSceneMessages({
      doc: normalizeInput('三天后，我回到茶馆。'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      interludeFill: true,
    })
    expect(on[0].content).toContain('把空白补上')
    expect(on[0].content).toContain('不是冻结的')
    expect(on[0].content).toContain('"interlude"')
    expect(on[0].content).toContain('不要凭空加新角色、新事件、新矛盾')

    const off = buildSceneMessages({
      doc: normalizeInput('三天后，我回到茶馆。'),
      segments: [],
      pcName: '我',
      pcPersona: '',
      storyTitle: '测试',
      interludeFill: false,
    })
    expect(off[0].content).toContain('不要补全任何时间跳跃期间的事')
    expect(off[0].content).not.toContain('不是冻结的')
  })

  it('共享那段所有人都看得到，各自的那条只给本人', () => {
    const linyan = buildContextBundle({
      card: card('林砚'),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
    })
    const aqi = buildContextBundle({
      card: card('阿七'),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
    })

    expect(linyan.interlude?.summary).toContain('靠里那桌一直空着')
    expect(linyan.interlude?.mine).toContain('把那半盏茶的位置留着')
    expect(aqi.interlude?.mine).toContain('把后院的柴劈完了')
    // 别人的那条不会串到他这里
    expect(linyan.interlude?.mine).not.toContain('劈柴')
    expect(linyan.interlude?.mine).not.toContain('后院的柴')
  })

  it('补全会写进角色这一轮的提示词', () => {
    const bundle = buildContextBundle({
      card: card('林砚'),
      segments: [],
      cards: [],
      pcName: '我',
      sceneSetup: setup(),
    })
    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content

    expect(user).toContain('【这之前】这三天茶馆照常开着')
    expect(user).toContain('【这段时间你在做什么】他每天照常开门')
  })

  it('往事里也带着那段空白期，回看时接得上', () => {
    const history: HistoryRound[] = [
      {
        index: 1,
        time: '三天后',
        place: '城南茶馆',
        atmosphere: '',
        pressure: '',
        escalation: '',
        interludeSummary: '这三天茶馆照常开着。',
        interludeMine: '他每天照常开门。',
        pcProfile: '',
        presentNames: [],
        sceneLines: [],
        events: [],
        inner: '',
      },
    ]
    const bundle: ContextBundle = {
      ...buildContextBundle({
        card: card('林砚'),
        segments: [],
        cards: [],
        pcName: '我',
        sceneSetup: setup(),
      }),
      history,
    }

    const user = buildRoleplayMessages({ bundle, project: DEFAULT_PROJECT_SETTINGS })[1].content
    expect(user).toContain('【这之前】这三天茶馆照常开着。')
    expect(user).toContain('【这段时间你在做什么】他每天照常开门。')
  })
})
