import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppStore } from '@/store/appStore'
import { SEGMENT_KIND_LABEL, type Segment, type SegmentKind } from '@/types/segment'
import { SCENE_MODE_LABEL } from '@/types/scene'
import { RATING_LABEL, type ContentRating, type Round } from '@/types/step'
import { isRoundDraftDirty } from '@/utils/roundDraft'
import {
  getComposeOfRound,
  getExposureOfRound,
  getSceneOfRound,
  getSegmentsOfRound,
  getSituationOfRound,
  regenerateRoundFromInput,
  replayFromRound,
} from './usePipelineActions'
import SegmentList from './SegmentList'
import ReactionCardView from './ReactionCardView'

function renderHighlighted(text: string, segments: Segment[]): ReactNode[] {
  const ranges = segments
    .map((segment) => ({ range: segment.sourceRange, kind: segment.kind, id: segment.id }))
    .filter((item) => item.range[1] > item.range[0])
    .sort((a, b) => a.range[0] - b.range[0])

  const nodes: ReactNode[] = []
  let cursor = 0
  ranges.forEach((item) => {
    const [start, end] = item.range
    if (start < cursor) return
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(
      <mark key={item.id} title={SEGMENT_KIND_LABEL[item.kind]}>
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/** 演示模式（?demo=…）用来控制界面初始展开状态，方便截图 */
function demoParam(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('demo')
}

function RoundBlock({ round, isLast, demo }: { round: Round; isLast: boolean; demo: string | null }) {
  const steps = useAppStore((state) => state.steps)
  const rounds = useAppStore((state) => state.rounds)
  const busy = useAppStore((state) => state.busy)
  const [showSegments, setShowSegments] = useState(demo === 'segments')
  const [editing, setEditing] = useState(false)
  const [inputDraft, setInputDraft] = useState(round.userInput)
  const [ratingDraft, setRatingDraft] = useState<ContentRating>(round.rating ?? 'general')
  const [directDraft, setDirectDraft] = useState(Boolean(round.direct))
  void steps

  const laterCount = rounds.filter(
    (item) => item.sessionId === round.sessionId && item.index > round.index,
  ).length

  const inputChanged = inputDraft.trim() !== round.userInput.trim()
  const ratingChanged = ratingDraft !== (round.rating ?? 'general')
  const directChanged = directDraft !== Boolean(round.direct)
  const dirty = isRoundDraftDirty(round, { userInput: inputDraft, rating: ratingDraft, direct: directDraft })

  const segmentsData = getSegmentsOfRound(round.id)
  const sceneData = getSceneOfRound(round.id)
  const project = useAppStore((state) => state.project)
  const composeData = getComposeOfRound(round.id)
  const situationData = getSituationOfRound(round.id)
  const exposureData = getExposureOfRound(round.id)
  const reactions = composeData?.scene.reactions ?? []
  const setup = sceneData?.setup

  const typeCounts = (segmentsData?.segments ?? []).reduce<Record<string, number>>((acc, segment) => {
    acc[segment.kind] = (acc[segment.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className="round-block" id={`round-${round.id}`}>
      <div className="round-divider">
        <span className="round-index">第 {round.index} 轮</span>
        {round.rating === 'r18' ? (
          <span
            className={`chip chip-r18${round.direct ? ' chip-r18-direct' : ''}`}
            title={round.direct ? '成人向 · 快速入戏' : '成人向'}
          >
            R18{round.direct ? ' · 快速入戏' : ''}
          </span>
        ) : null}
        {round.status === 'running' ? <span className="chip chip-warn">生成中</span> : null}
        {round.status === 'error' ? <span className="chip chip-error">有步骤失败</span> : null}
        <div className="round-line" />
        <button
          className="btn btn-sm btn-ghost round-replay"
          title="作废这一轮之后的所有轮次，并重新生成这一轮"
          onClick={() => void replayFromRound(round.id)}
        >
          从这一轮重演
        </button>
      </div>

      {/* 1. 场面 */}
      {setup ? (
        <div className="scene-card">
          <div className="scene-card-head">
            <span className="scene-label">场面</span>
            {setup.time ? <span className="chip">{setup.time}</span> : null}
            {setup.place ? <span className="chip">{setup.place}</span> : null}
            {setup.atmosphere ? <span className="chip">{setup.atmosphere}</span> : null}
            <span className={`chip ${setup.inputMode === 'outline' ? 'chip-warn' : ''}`}>
              {SCENE_MODE_LABEL[setup.inputMode]}
            </span>
            {!setup.usedModel ? <span className="chip">规则降级</span> : null}
          </div>

          {setup.opening.length ? (
            setup.opening.map((line, index) => (
              <div key={index} className="scene-line">
                {line}
              </div>
            ))
          ) : (
            <div className="hint">（素材里没有环境描写）</div>
          )}

          {setup.situation ? <div className="scene-situation">▸ {setup.situation}</div> : null}

          {setup.interlude ? (
            <div className="scene-interlude">
              {setup.interlude.summary ? <div>〔这之前〕{setup.interlude.summary}</div> : null}
              {setup.interlude.each.map((item) => (
                <div key={item.who} className="scene-interlude-each">
                  {item.who}：{item.what}
                </div>
              ))}
            </div>
          ) : null}

          {situationData?.state.pressure ? (
            <div className="scene-pressure">
              <span className="hint">局面：</span>
              {situationData.state.pressure}
            </div>
          ) : null}

          {setup.present.length ? (
            <div className="scene-cast">
              <span className="hint">在场：</span>
              {setup.present.map((item) => (
                <span key={item.name} className="chip">
                  {item.name}
                  {item.kind === 'extra' ? '（路人）' : ''}
                  {item.active ? '' : '（背景）'}
                </span>
              ))}
            </div>
          ) : null}

          {!setup.usedModel ? (
            <div className="scene-fallback">未调用模型：{setup.fallbackReason || '原因未知'}</div>
          ) : null}
        </div>
      ) : null}

      {/* 2. 你的输入 */}
      <div className="input-block">
        <div className="input-block-head" onClick={() => setShowSegments((value) => !value)}>
          <span className="who-badge">你</span>
          <span className="hint">
            {segmentsData
              ? `${segmentsData.segments.length} 个片段 · ${Object.entries(typeCounts)
                  .map(([kind, count]) => `${SEGMENT_KIND_LABEL[kind as SegmentKind] ?? kind}×${count}`)
                  .join(' ')} · 点击${showSegments ? '收起' : '查看并编辑'}拆解`
              : '尚未拆解'}
          </span>
          <div style={{ flex: 1 }} />
          {!editing ? (
            <>
              <button
                className="btn btn-sm"
                title="直接改整段原文或分级，然后重新生成"
                onClick={(event) => {
                  event.stopPropagation()
                  setInputDraft(round.userInput)
                  setRatingDraft(round.rating ?? 'general')
                  setEditing(true)
                }}
              >
                编辑原文
              </button>
              <span className="chev">{showSegments ? '▾' : '▸'}</span>
            </>
          ) : null}
        </div>

        {editing ? (
          <div className="input-editor">
            <textarea
              className="textarea"
              rows={6}
              autoFocus
              value={inputDraft}
              onChange={(event) => setInputDraft(event.target.value)}
            />
            <div className="input-editor-actions">
              <button
                className="btn btn-primary"
                disabled={busy || !inputDraft.trim() || !dirty}
                onClick={() => {
                  // 立刻退出编辑态：生成进度在主看板顶部的状态条上
                  setEditing(false)
                  document
                    .getElementById(`round-${round.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  void regenerateRoundFromInput(round.id, inputDraft, ratingDraft, directDraft)
                }}
              >
                {busy ? '生成中…' : '保存并重新生成'}
              </button>
              <button className="btn" disabled={busy} onClick={() => setEditing(false)}>
                取消
              </button>
              {project?.allowR18 ? (
              <label
                className={`r18-toggle ${ratingDraft === 'r18' ? 'on' : ''}`}
                title="这一轮往成人向推进 —— 只影响角色能自己控制的那部分，不改人设，也不一步到位"
              >
                <input
                  type="checkbox"
                  checked={ratingDraft === 'r18'}
                  disabled={busy}
                  onChange={(event) => setRatingDraft(event.target.checked ? 'r18' : 'general')}
                />
                R18 模式
              </label>
              ) : null}
              {project?.allowR18 && ratingDraft === 'r18' ? (
                <label
                  className={`r18-toggle ${directDraft ? 'on' : ''}`}
                  title="这一轮直接进入性描写，不再铺垫。人物模糊地带倾向成人向，写死的底线不变"
                >
                  <input
                    type="checkbox"
                    checked={directDraft}
                    disabled={busy}
                    onChange={(event) => setDirectDraft(event.target.checked)}
                  />
                  快速入戏
                </label>
              ) : null}
              <span className="hint">
                {!dirty
                  ? '内容和分级都没变'
                  : [
                      inputChanged ? '整轮会重新拆解、重新分发给每个角色' : null,
                      ratingChanged ? `分级改为 ${RATING_LABEL[ratingDraft]}` : null,
                      directChanged ? `快速入戏：${directDraft ? '开' : '关'}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                {laterCount ? ` · 这一轮之后的 ${laterCount} 轮会被丢弃` : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="original-text">
            {segmentsData ? renderHighlighted(round.userInput, segmentsData.segments) : round.userInput}
          </div>
        )}

        {!editing && showSegments && segmentsData ? (
          <div style={{ marginTop: 12 }}>
            {segmentsData.usedModel ? null : (
              <div className="info-box">
                这一轮是规则预标注（没有调用模型，或者模型不可用）。
                {segmentsData.fallbackReason ? ` 原因：${segmentsData.fallbackReason}` : ''}
              </div>
            )}
            <SegmentList stepId={segmentsData.stepId} segments={segmentsData.segments} />
          </div>
        ) : null}
      </div>

      {/* 2b. 别人眼里的你：从你的内心外化而来 */}
      {exposureData && exposureData.exposure.cues.length ? (
        <div className="exposure-card">
          <div className="exposure-head">
            <span className="scene-label" style={{ color: 'var(--pink)' }}>
              别人眼里的你
            </span>
            <span className="hint">你的内心没有直接给他们，只给了这些现象</span>
          </div>
          {exposureData.exposure.cues.map((cue) => (
            <div key={cue.id} className="exposure-item">
              <span className="exposure-visible">▸ {cue.visible}</span>
              <span className="exposure-hidden">（你心里：{cue.hidden}）</span>
              <span className="chip">可读性 {Math.round(cue.readability * 100)}%</span>
              <span className="chip">泄漏 {Math.round(cue.leakage * 100)}%</span>
            </div>
          ))}
          {exposureData.exposure.note ? <div className="hint">{exposureData.exposure.note}</div> : null}
        </div>
      ) : null}

      {/* 2.5 世界自己往前走的那一步 —— 不是任何人的话，是局面的变化 */}
      {situationData?.state.events.length ? (
        <div className="situation-block">
          <div className="situation-head">
            <span className="who-badge who-world">局面</span>
            {situationData.state.usedModel ? null : <span className="hint">未调用模型</span>}
          </div>
          {situationData.state.events.map((event, index) => (
            <div key={index} className={`situation-event situation-event-${event.kind}`}>
              {event.text}
            </div>
          ))}
          {situationData.state.reason?.trim() ? (
            <details className="situation-reason">
              <summary>为什么是此刻</summary>
              {situationData.state.reason}
            </details>
          ) : null}

          {situationData.state.routes?.length ? (
            <div className="situation-routes">
              <div className="situation-routes-head">
                这个局面直接入戏会崩，导演给了几条路 —— 点一条填进输入框，你可以改：
              </div>
              {situationData.state.routes.map((route, index) => (
                <button
                  key={index}
                  className="situation-route"
                  onClick={() => useAppStore.getState().injectDraft(`（${route.title}）${route.detail ? `\n${route.detail}` : ''}`)}
                >
                  <span className="situation-route-title">▸ {route.title}</span>
                  {route.detail ? <span className="situation-route-detail">{route.detail}</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          {situationData.state.holdUp?.trim() ? (
            <details className="situation-reason">
              <summary>为什么这一轮没有更进一步</summary>
              {situationData.state.holdUp}
            </details>
          ) : null}

          {round.rating === 'r18' && situationData.state.r18Streak > 1 ? (
            <div className="situation-streak">
              成人向已持续 {situationData.state.r18Streak} 轮
            </div>
          ) : null}
          {situationData.state.r18Ended ? (
            <div className="situation-escalation">这一幕收尾了 · R18 模式已自动关闭</div>
          ) : null}
          {situationData.state.escalation ? (
            <div className="situation-escalation">下一步：{situationData.state.escalation}</div>
          ) : null}
        </div>
      ) : null}

      {/* 3. 各角色的反应 */}
      {reactions.length ? (
        <div className="reactions">
          {reactions.map((reaction, index) => (
            <ReactionCardView
              key={reaction.characterId}
              roundId={round.id}
              reaction={reaction}
              defaultOpenContext={demo === 'context' && isLast && index === 0}
              defaultOpenInner={demo === 'inner' && isLast && index === 0}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default function BoardView() {
  const sessionId = useAppStore((state) => state.activeSessionId)
  const sessions = useAppStore((state) => state.sessions)
  const allRounds = useAppStore((state) => state.rounds)
  const rounds = allRounds
    .filter((round) => round.sessionId === sessionId)
    .sort((a, b) => a.index - b.index)

  const bottomRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(rounds.length)

  // 新的一轮出现时滑到它那里
  useEffect(() => {
    if (rounds.length !== lastCount.current) {
      lastCount.current = rounds.length
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [rounds.length])

  const session = sessions.find((item) => item.id === sessionId)

  if (!sessionId || !rounds.length) {
    return (
      <div className="empty">
        <strong>{session ? `「${session.title}」还没有内容。` : '还没有开始。'}</strong>
        <br />
        在下面的输入框里写点什么，然后点「发送」。
        <br />
        具体演出或者一句概要都行——比如「（我遇到了金刚狼）」。
      </div>
    )
  }

  return (
    <div className="story-stream">
      <div className="session-head">
        <h2>{session?.title ?? '对话'}</h2>
        <span className="hint">{rounds.length} 轮</span>
      </div>
      {rounds.map((round, index) => (
        <RoundBlock key={round.id} round={round} isLast={index === rounds.length - 1} demo={demoParam()} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
