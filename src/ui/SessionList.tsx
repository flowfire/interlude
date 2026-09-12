import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_SESSION_TITLE } from '@/types/step'
import { formatRelative } from '@/utils/time'

function dotOf(status: string): string {
  if (status === 'done') return 'dot-done'
  if (status === 'running') return 'dot-running'
  if (status === 'error') return 'dot-error'
  if (status === 'stale') return 'dot-stale'
  return 'dot-pending'
}

/**
 * 左栏：对话目录。
 *
 * 一轮不是在"新建轮次"里产生的 —— 直接在输入框里写就行。
 * 这里切换的是**完全无关的另一条故事线**。
 */
export default function SessionList() {
  const sessions = useAppStore((state) => state.sessions)
  const rounds = useAppStore((state) => state.rounds)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const setActiveSession = useAppStore((state) => state.setActiveSession)
  const newSession = useAppStore((state) => state.newSession)
  const renameSession = useAppStore((state) => state.renameSession)
  const deleteSession = useAppStore((state) => state.deleteSession)
  const saveUndo = useAppStore((state) => state.saveUndo)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (id: string, title: string) => {
    setEditingId(id)
    setDraft(title === DEFAULT_SESSION_TITLE ? '' : title)
  }

  const commit = () => {
    if (editingId) renameSession(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="left-col">
      <div className="side-section">
        <button className="btn" style={{ width: '100%' }} onClick={() => newSession()}>
          ＋ 新的对话
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          只有在想开一条<strong>完全无关的新故事线</strong>时才需要它。同一场戏往下走，直接在输入框里写就行。
        </div>
      </div>

      <div className="side-section">
        <h3 className="panel-title">
          对话目录
          <span className="hint">{sessions.length} 个</span>
        </h3>

        {sessions.length === 0 ? (
          <div className="hint">还没有对话。在下面写一段素材试试。</div>
        ) : (
          [...sessions].reverse().map((session) => {
            const own = rounds
              .filter((round) => round.sessionId === session.id)
              .sort((a, b) => a.index - b.index)
            const lastStatus = own.length ? own[own.length - 1].status : 'draft'
            const active = session.id === activeSessionId

            return (
              <div
                key={session.id}
                className={`round-item ${active ? 'active' : ''}`}
                onClick={() => setActiveSession(session.id)}
              >
                {editingId === session.id ? (
                  <input
                    className="input"
                    autoFocus
                    value={draft}
                    placeholder={DEFAULT_SESSION_TITLE}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="r-title">
                      <span className={`dot ${dotOf(lastStatus)}`} />
                      <span
                        style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={session.title}
                      >
                        {session.title}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="改名"
                        onClick={(event) => {
                          event.stopPropagation()
                          startEdit(session.id, session.title)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="删除整个对话"
                        onClick={(event) => {
                          event.stopPropagation()
                          saveUndo(`删除对话「${session.title}」`)
                          deleteSession(session.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="r-sub">
                      {own.length} 轮 · {own[0]?.userInput.trim().slice(0, 22) || '（还没写内容）'}
                    </div>
                    <div className="r-sub" style={{ marginTop: 0 }}>{formatRelative(session.updatedAt)}</div>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
