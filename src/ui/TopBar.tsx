import { sumCost } from '@/engine/graph/stepGraph'
import { llmClient } from '@/engine/llm/instance'
import { useAppStore } from '@/store/appStore'

export default function TopBar() {
  const statusText = useAppStore((state) => state.statusText)
  const busy = useAppStore((state) => state.busy)
  const project = useAppStore((state) => state.project)
  const steps = useAppStore((state) => state.steps)
  const rounds = useAppStore((state) => state.rounds)
  const sessions = useAppStore((state) => state.sessions)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const undoSnapshot = useAppStore((state) => state.undoSnapshot)
  const undoLabel = useAppStore((state) => state.undoLabel)
  const undoLast = useAppStore((state) => state.undoLast)

  const cost = sumCost(steps)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const ownRounds = rounds.filter((round) => round.sessionId === activeSessionId)
  const lastRound = ownRounds.length ? ownRounds[ownRounds.length - 1] : undefined
  const configured = llmClient.isConfigured

  return (
    <div className="topbar">
      <div className="brand">
        幕间<span className="en">INTERLUDE</span>
      </div>

      <div className="meta">
        <span>{project.storyTitle}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>
          你扮演：<span style={{ color: 'var(--accent)' }}>{project.pcName}</span>
        </span>
        {activeSession ? (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>{activeSession.title}</span>
          </>
        ) : null}
        {lastRound ? (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>{ownRounds.length} 轮</span>
          </>
        ) : null}
      </div>

      <div className="spacer" />

      {busy ? (
        <div className="meta">
          <span className="spin" />
          <span>{statusText || '处理中…'}</span>
        </div>
      ) : null}

      {cost.calls > 0 ? (
        <div className="meta" title="本工作区累计的模型调用与 token">
          <span>
            {cost.calls} 次调用 · {(cost.tokensIn + cost.tokensOut).toLocaleString()} tokens
          </span>
        </div>
      ) : null}

      {undoSnapshot ? (
        <button className="btn btn-sm undo-btn" onClick={undoLast} title="恢复上一次丢弃的内容">
          ↶ 撤销{undoLabel ? `：${undoLabel}` : ''}
        </button>
      ) : null}

      {!configured ? <span className="chip chip-warn">未配置模型</span> : null}

      <button className="btn" onClick={() => setSettingsOpen(true)}>
        设置
      </button>
    </div>
  )
}
