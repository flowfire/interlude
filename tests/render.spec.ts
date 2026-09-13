import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import App from '@/App'
import ContextView from '@/ui/ContextView'
import InputBar from '@/ui/InputBar'
import { useAppStore } from '@/store/appStore'
import type { ContextBundle } from '@/types/character'

describe('界面冒烟', () => {
  it('空状态下 App 能完整渲染，不抛错', () => {
    const html = renderToString(createElement(App))
    expect(html).toContain('幕间')
    // 输入区在底部，并且带「我自己的人设」入口
    expect(html).toContain('我自己的人设')
    expect(html).toContain('发送')
    expect(html).toContain('示例：概要')
    // 还没有轮次时给出引导
    expect(html).toContain('还没有开始')
  })
})

/** 造一个最小可用的上下文包 */
function makeBundle(history: ContextBundle['history']): ContextBundle {
  return {
    characterId: 'c1',
    name: '林砚',
    card: {
      id: 'c1',
      name: '林砚',
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
    },
    roundIndex: 2,
    pcName: '我',
    counterpartProfile: '站在门口没动',
    presentNames: ['我', '林砚'],
    scene: { time: '傍晚', place: '城南茶馆', atmosphere: '雨刚停' },
    perceived: [{ kind: 'speech', from: '我', text: '我来了。', self: false }],
    sceneLines: ['屋里只有一盏灯'],
    heard: [],
    seen: [],
    ownThoughts: [],
    ownPriorLines: [],
    extras: [],
    pcCues: [],
    knownFacts: [],
    doesNotKnow: ['我的真实想法'],
    recalled: [],
    recap: '',
    pressure: '',
    escalation: '',
    history,
  }
}

describe('上下文面板', () => {
  it('把往事逐轮摊开，不带指令性文字也看得懂', () => {
    const bundle = makeBundle([
      {
        index: 1,
        time: '傍晚',
        place: '城南茶馆',
        atmosphere: '雨刚停',
        pressure: '狼群在二十步外',
        escalation: '再有两三息它们就会扑上来',
        interludeSummary: '',
        interludeMine: '',
        pcProfile: '站在门口没动',
        presentNames: ['我', '林砚'],
        sceneLines: ['雨刚停'],
        events: [{ kind: 'speech', from: '我', text: '第一轮说过的话', self: false }],
        inner: '第一轮他心里在想的事',
      },
    ])

    const html = renderToString(createElement(ContextView, { bundle, roundId: 'r2' }))
    expect(html).toContain('往事')
    expect(html).toContain('第一轮说过的话')
    expect(html).toContain('第一轮他心里在想的事')
    expect(html).toContain('我来了。')
  })

  it('他不在场的轮次在面板上标明，不带内容', () => {
    const html = renderToString(
      createElement(ContextView, {
        bundle: makeBundle([
          {
            index: 2,
            absent: true,
            absentThrough: 4,
            time: '',
            place: '',
            atmosphere: '',
            pressure: '',
            escalation: '',
        interludeSummary: '',
        interludeMine: '',
            pcProfile: '',
            presentNames: [],
            sceneLines: [],
            events: [],
            inner: '',
          },
        ]),
        roundId: 'r5',
      }),
    )
    expect(html).toContain('他不在场')
    // React SSR 会在插值处插注释，所以只断言拼接得起来的那几段
    expect(html).toContain(' ~ 第 ')
    expect(html).toContain('ctx-history-absent')
  })

  it('还没有往事时说明这是第一轮', () => {
    const html = renderToString(createElement(ContextView, { bundle: makeBundle([]), roundId: 'r1' }))
    expect(html).toContain('还没有往事')
  })
})

describe('输入区的分级勾选', () => {
  afterEach(() => {
    useAppStore.getState().setComposer({ rating: 'general', direct: false })
  })

  it('没开总闸时，输入区看不到任何成人向的东西', () => {
    const html = renderToString(createElement(InputBar))
    expect(html).not.toContain('R18 模式')
    expect(html).not.toContain('快速入戏')
  })

  // 注意：SSR 下 zustand 读的是 initial state，所以"运行时改 store 再渲染"
  // 这条路测不出来（勾选框出现与否由上面的默认态 + 下面的 store 行为共同保证）。
  it('勾选住在 store 里 —— 导演才能替用户把它关掉', () => {
    useAppStore.getState().setComposer({ rating: 'r18', direct: true })
    expect(useAppStore.getState().composer).toEqual({ rating: 'r18', direct: true })

    // 关掉 R18 时「快速入戏」必须一起失效 —— 它只在成人向那一轮有意义
    useAppStore.getState().setComposer({ rating: 'general', direct: false })
    expect(useAppStore.getState().composer).toEqual({ rating: 'general', direct: false })
  })
})
