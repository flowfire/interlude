import { useEffect, useMemo, useRef } from 'react'
import TopBar from './ui/TopBar'
import SessionList from './ui/SessionList'
import InputBar from './ui/InputBar'
import BoardView from './ui/BoardView'
import StepHistoryPanel from './ui/StepHistoryPanel'
import StepInspector from './ui/StepInspector'
import SettingsDialog from './ui/SettingsDialog'
import { useAppStore } from './store/appStore'
import { pickBackdrop } from './utils/sceneBackdrop'

export default function App() {
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const inspectorStepId = useAppStore((state) => state.inspectorStepId)
  const error = useAppStore((state) => state.error)
  const setError = useAppStore((state) => state.setError)
  const busy = useAppStore((state) => state.busy)
  const statusText = useAppStore((state) => state.statusText)
  const stuckRoundId = useAppStore((state) => state.stuckRoundId)
  const sceneImages = useAppStore((state) => state.sceneImages)
  const rounds = useAppStore((state) => state.rounds)
  const sessionId = useAppStore((state) => state.activeSessionId)

  const firstRoundId = useMemo(
    () =>
      rounds
        .filter((round) => round.sessionId === sessionId)
        .sort((a, b) => a.index - b.index)[0]?.id ?? '',
    [rounds, sessionId],
  )
  const activeSceneImage = pickBackdrop({ stuckRoundId, firstRoundId, sceneImages })

  /**
   * 「哪张场面卡贴在顶上」由**这里**算。
   *
   * 放在 App 而不是 BoardView，是因为 `.scroll-area` 这个滚动容器是 App 渲染的 ——
   * 之前把监听写在 BoardView 里，`scrollRef` 永远挂不上（那个 div 不在它的子树里），
   * 于是 `update()` 一次都没跑过，`stuckRoundId` 恒为 null，背景就永远停在第一张。
   *
   * 只认**最后一个已经滚过顶部的卡**：这样有唯一赢家，不依赖 effect 的执行顺序。
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      timer = undefined
      const box = scroller.getBoundingClientRect()
      const cards = scroller.querySelectorAll<HTMLElement>('[data-scene-card]')

      // 找"贴在滚动区顶部的那张"。
      //
      // 判据要带一点容差（30px）：sticky 钉住的位置并不等于 CSS 里写的 top ——
      // 它受滚动容器 padding 影响（实测钉在距容器顶 24px，而不是 -1px）。
      // 原来卡死在 1px 上，于是**永远没有卡被认成吸顶**，背景就一直停在第一张。
      //
      // 同时要求 bottom 还在下方：被下一轮顶走的那张虽然 top 更靠上，
      // 但它已经离开视口，不该再代表当前位置。
      let current: string | null = null
      for (const card of cards) {
        const rect = card.getBoundingClientRect()
        if (rect.top <= box.top + 30 && rect.bottom > box.top) {
          current = card.dataset.roundId ?? null
          break
        }
      }
      const store = useAppStore.getState()
      if (store.stuckRoundId !== current) store.setStuckRoundId(current)
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
    <div
      className={`app${activeSceneImage ? ' has-scene-image' : ''}`}
      style={
        activeSceneImage
          ? ({ '--app-scene-image': `url("${activeSceneImage}")` } as React.CSSProperties)
          : undefined
      }
    >
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
