import { useMemo } from 'react'
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
          <div className="scroll-area">
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
