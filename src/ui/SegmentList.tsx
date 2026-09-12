import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { SEGMENT_KIND_HINT, SEGMENT_KIND_LABEL, type Segment, type SegmentKind } from '@/types/segment'

const KIND_ORDER: SegmentKind[] = [
  'scene',
  'action',
  'speech',
  'inner',
  'narration',
  'worldfact',
  'offscreen',
  'ambient',
  'unknown',
]

interface Props {
  stepId: string
  segments: Segment[]
}

/** 拆解结果的编辑器：改标签、改文本、翻转锁定 */
export default function SegmentList({ stepId, segments }: Props) {
  const updateSegment = useAppStore((state) => state.updateSegment)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  return (
    <div className="seg-list">
      {segments.map((segment) => {
        const isEditing = editingId === segment.id
        const rowClass = [
          'seg-row',
          segment.isFact ? 'is-locked' : '',
          segment.confidence < 0.5 ? 'low-confidence' : '',
          segment.visibility === 'private' ? 'private-seg' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div key={segment.id} className={rowClass}>
            <div className="seg-kind-cell">
              <select
                value={segment.kind}
                onChange={(event) => updateSegment(stepId, segment.id, { kind: event.target.value as SegmentKind })}
              >
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {SEGMENT_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <span className="seg-kind-hint">{SEGMENT_KIND_HINT[segment.kind]}</span>
            </div>

            <div className="seg-body">
              {isEditing ? (
                <div>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        updateSegment(stepId, segment.id, { text: editingText })
                        setEditingId(null)
                      }}
                    >
                      保存
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="seg-text">{segment.text}</div>
              )}

              <div className="seg-meta">
                {segment.speaker ? <span className="chip">说：{segment.speaker}</span> : null}
                {segment.addressee?.length ? <span className="chip">对：{segment.addressee.join('、')}</span> : null}
                {segment.subject?.length ? <span className="chip">主体：{segment.subject.join('、')}</span> : null}
                {segment.location ? <span className="chip">地点：{segment.location}</span> : null}
                <span className="chip">{Math.round(segment.confidence * 100)}%</span>
                <span className="chip">{segment.origin === 'rule' ? '规则' : '模型'}</span>
                {segment.visibility === 'private' ? <span className="chip chip-warn">不外传</span> : null}
                {segment.reason ? (
                  <span className="hint" title={segment.reason}>
                    ⓘ {segment.reason.length > 26 ? `${segment.reason.slice(0, 26)}…` : segment.reason}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="seg-actions">
              <button
                className={`btn btn-sm ${segment.isFact ? 'btn-primary' : ''}`}
                title={segment.isFact ? '已锁定：AI 不能改写这一条' : '可演绎：AI 可以按人设改写这一条'}
                onClick={() => updateSegment(stepId, segment.id, { isFact: !segment.isFact })}
              >
                {segment.isFact ? '🔒 锁定' : '🔓 放开'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setEditingId(segment.id)
                  setEditingText(segment.text)
                }}
              >
                编辑
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
