import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './ui/TopBar'
import SessionList from './ui/SessionList'
import InputBar from './ui/InputBar'
import BoardView from './ui/BoardView'
import StepHistoryPanel from './ui/StepHistoryPanel'
import StepInspector from './ui/StepInspector'
import SettingsDialog from './ui/SettingsDialog'
import { useAppStore } from './store/appStore'
import { pickBackdrop } from './utils/sceneBackdrop'
import { applyR18Suggestion } from './ui/usePipelineActions'

export default function App() {
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const inspectorStepId = useAppStore((state) => state.inspectorStepId)
  const error = useAppStore((state) => state.error)
  const setError = useAppStore((state) => state.setError)
  const busy = useAppStore((state) => state.busy)
  const statusText = useAppStore((state) => state.statusText)
  const sceneRoundId = useAppStore((state) => state.sceneRoundId)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const sceneImages = useAppStore((state) => state.sceneImages)
  const rounds = useAppStore((state) => state.rounds)
  const sessionId = useAppStore((state) => state.activeSessionId)

  const sessionRounds = useMemo(
    () =>
      rounds
        .filter((round) => round.sessionId === sessionId)
        .sort((a, b) => a.index - b.index),
    [rounds, sessionId],
  )
  /** 两层背景的槽位与当前激活的那层 —— 用来做交叉淡入 */
  const [backdrop, setBackdrop] = useState<{ slots: [string, string]; active: 0 | 1 }>({
    slots: ['', ''],
    active: 0,
  })

  const activeSceneImage = pickBackdrop({
    stuckRoundId: sceneRoundId,
    firstRoundId: sessionRounds[0]?.id ?? '',
    roundOrder: sessionRounds.map((round) => round.id),
    sceneImages,
  })

  /**
   * 「哪张场面卡贴在顶上」由**这里**算。
   *
   * 放在 App 而不是 BoardView，是因为 `.scroll-area` 这个滚动容器是 App 渲染的 ——
   * 之前把监听写在 BoardView 里，`scrollRef` 永远挂不上（那个 div 不在它的子树里），
   * 于是 `update()` 一次都没跑过，`stuckRoundId` 恒为 null，背景就永远停在第一张。
   *
   * 只认**最后一个已经滚过顶部的卡**：这样有唯一赢家，不依赖 effect 的执行顺序。
   */
  /**
   * 导演在最后一轮请求了开启成人向 —— **刷新页面之后这个请求仍然有效**。
   *
   * 它是一个**派生事实**（就摆在那一轮的产物里），不是"跑完那一刻的通知"。
   * 所以这里在挂载时、以及切回某条对话时重新认一次；早先只认"跑完那一下"，
   * 一刷新就丢了。
   *
   * 只在切对话时跑，不在每次渲染时跑 —— 用户在这一轮里手动取消之后，
   * 不该被立刻勾回来。
   */
  useEffect(() => {
    applyR18Suggestion()
  }, [activeSessionId])

  // 图换了 → 预加载好再切，避免淡入的过程中先露出一片空白
  useEffect(() => {
    if (!activeSceneImage || activeSceneImage === backdrop.slots[backdrop.active]) return
    let cancelled = false
    const next = (backdrop.active === 0 ? 1 : 0) as 0 | 1
    const image = new Image()
    const swap = () => {
      if (cancelled) return
      setBackdrop((prev: { slots: [string, string]; active: 0 | 1 }) => {
        const slots: [string, string] = [prev.slots[0], prev.slots[1]]
        slots[next] = activeSceneImage
        return { slots, active: next }
      })
    }
    image.onload = swap
    image.onerror = swap
    image.src = activeSceneImage
    return () => {
      cancelled = true
    }
  }, [activeSceneImage, backdrop.active, backdrop.slots])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      timer = undefined
      const box = scroller.getBoundingClientRect()
      const blocks = scroller.querySelectorAll<HTMLElement>('[data-scene-card]')

      // 取**最后一个已经滚过顶部的那张场景卡** —— 它代表当前所在的场景。
      //
      // 卡的数量等于**场景数**（不是轮次数）：同一个场景覆盖好几轮时共用一张卡。
      // 所以这里不需要任何"轮次"的概念，扫一遍卡就行。
      //
      // 30px 容差：sticky 实际钉住的位置受滚动容器 padding 影响，并不等于
      // CSS 里写的 top。
      let current: string | null = null
      for (const block of blocks) {
        if (block.getBoundingClientRect().top - box.top <= 30) current = block.dataset.roundId ?? null
        else break
      }
      const store = useAppStore.getState()
      if (store.sceneRoundId !== current) store.setSceneRoundId(current)
    }
    const onScroll = () => {
      if (timer) return
      timer = setTimeout(update, 16)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
    }
  }, [rounds.length])


  return (
    <div className="app">
      {/* 背景用**两层交叉淡入**：background-image 本身不能过渡，直接换会是硬切。
          新图先放进备用层、等它加载完再切 active，两张的 opacity 一起过渡，
          看起来就是缓慢地化过去。
          最后一层空着也无妨 —— opacity 都是 0，不会显示。 */}
      <div
        className={`scene-backdrop${backdrop.active === 0 ? ' on' : ''}`}
        style={backdrop.slots[0] ? { backgroundImage: `url("${backdrop.slots[0]}")` } : undefined}
      />
      <div
        className={`scene-backdrop${backdrop.active === 1 ? ' on' : ''}`}
        style={backdrop.slots[1] ? { backgroundImage: `url("${backdrop.slots[1]}")` } : undefined}
      />
      <TopBar />
      <div className="layout with-left">
        <SessionList />
        <div className="main-col">
          {busy ? (
            <div className="running-bar">
              <span className="spin" />
              <span>{statusText || '正在生成…'}</span>
            </div>
          ) : null}
          <div className="scroll-area" ref={scrollRef}>
            {error ? (
              <div className="error-box">
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ float: 'right', marginLeft: 10 }}
                  onClick={() => setError(null)}
                >
                  关闭
                </button>
                {error}
              </div>
            ) : null}
            <BoardView />
          </div>
          <InputBar />
        </div>
        <StepHistoryPanel />
      </div>
      {settingsOpen ? <SettingsDialog /> : null}
      {inspectorStepId ? <StepInspector /> : null}
    </div>
  )
}
