import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppStore } from '@/store/appStore'
import { groupRoundsByScene } from '@/utils/sceneGroups'
import { isRoundStalled } from '@/utils/r18'
import { SEGMENT_KIND_LABEL, type Segment, type SegmentKind } from '@/types/segment'
import { SCENE_MODE_LABEL, type SceneSetup } from '@/types/scene'
import { RATING_LABEL, type ContentRating, type Round, type Step } from '@/types/step'
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

/**
 * 场景卡 —— 一个场景一张，插在它所属那一轮的分隔符后面。
 *
 * 以前是每轮各渲染一张、靠 CSS sticky 彼此顶替。问题在于：场景沿用的轮次
 * 也会插一张内容相同的卡，滚动时看起来就是"一张新卡被推上来了"，
 * 哪怕内容一个字都没变 —— 那不是"场景没换"该有的观感。
 *
 * 现在只有一条，位置固定，**内容随当前场景更新**：场景没变时它纹丝不动，
 * 真的换了场景才刷新一次。
 */
function SceneCard({ sceneRoundId }: { sceneRoundId: string }) {
  const steps = useAppStore((state) => state.steps)
  const sceneImages = useAppStore((state) => state.sceneImages)
  const busy = useAppStore((state) => state.sceneImageBusy) === sceneRoundId
  const [imageError, setImageError] = useState('')
  // <details> 用 ref 控制开合，不用受控的 open 属性 —— React 挂载时的那次
  // toggle 事件会把它改成收起，导致"默认展开"看起来没生效。
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const setup = useMemo(() => {
    const step = Object.values(steps).find(
      (item) => item.roundId === sceneRoundId && item.stage === 'scene' && item.status === 'done',
    )
    return (step?.output as SceneSetup | undefined) ?? null
  }, [steps, sceneRoundId])

  const sceneImage = sceneImages[sceneRoundId] ?? ''

  // 换了场景就重算开合：有图默认收起（有图就能脑补环境，描述不必再占着）
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = !sceneImage
    setImageError('')
  }, [sceneRoundId, sceneImage])

  if (!setup) return null

  const generate = async () => {
    setImageError('')
    useAppStore.getState().setSceneImageBusy(sceneRoundId)
    try {
      const { generateSceneImage, sceneImagePrompt } = await import('@/engine/image/client')
      const url = await generateSceneImage({
        prompt: sceneImagePrompt({
          place: setup.place,
          atmosphere: setup.atmosphere,
          opening: setup.opening,
          situation: setup.situation,
        }),
        settings: useAppStore.getState().image,
      })
      useAppStore.getState().setSceneImage(sceneRoundId, url)
      if (detailsRef.current) detailsRef.current.open = false
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '生图失败')
    } finally {
      useAppStore.getState().setSceneImageBusy(null)
    }
  }

  return (
    <details className="scene-card" ref={detailsRef} data-scene-card data-round-id={sceneRoundId} open>
      <summary className="scene-card-head">
        <span className="scene-label">场景</span>
        {setup.time ? <span className="scene-chip">{setup.time}</span> : null}
        {setup.place ? <span className="scene-chip">{setup.place}</span> : null}
        {setup.present.length ? (
          <span className="scene-chip">在场 {setup.present.map((item) => item.name).join('、')}</span>
        ) : null}
        <span className={`chip ${setup.inputMode === 'outline' ? 'chip-warn' : ''}`}>
          {SCENE_MODE_LABEL[setup.inputMode]}
        </span>
        {!setup.usedModel ? <span className="chip">规则降级</span> : null}

        <span className="scene-image-tip">
          <button
            className={`scene-image-btn${imageError ? ' error' : ''}`}
            disabled={busy}
            title={
              imageError
                ? undefined
                : sceneImage
                  ? '重新生成这个场景的图'
                  : '按这个场景的描写生成一张图，会铺成整个界面的背景'
            }
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void generate()
            }}
          >
            {busy ? (
              '生成中'
            ) : imageError ? (
              '生图失败'
            ) : sceneImage ? (
              <>
                <span className="scene-image-btn-idle">生图</span>
                <span className="scene-image-btn-hover">重新生图</span>
              </>
            ) : (
              '生图'
            )}
          </button>
          {imageError ? <span className="scene-image-tip-text">{imageError}</span> : null}
        </span>
      </summary>

      <div className="scene-body">
        <div className="scene-main">
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
        </div>

        <div className="scene-side">
          {setup.atmosphere ? <div className="scene-side-row">气氛：{setup.atmosphere}</div> : null}
          {setup.interlude ? (
            <div className="scene-side-row">
              {setup.interlude.summary ? <div>〔这之前〕{setup.interlude.summary}</div> : null}
              {setup.interlude.each.map((item) => (
                <div key={item.who} className="scene-interlude-each">
                  {item.who}：{item.what}
                </div>
              ))}
            </div>
          ) : null}
          {setup.present.length ? (
            <div className="scene-side-row scene-cast">
              {setup.present.map((item) => (
                <span key={item.name} className="scene-chip">
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
      </div>
    </details>
  )
}

/** 轮次分隔符 —— 提在 RoundBlock 外面，好让场景卡插在它和内容之间 */
function RoundDivider({ round }: { round: Round }) {
  return (
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
  )
}

function RoundBlock({
  round,
  isLast,
  demo,
}: {
  round: Round
  isLast: boolean
  demo: string | null
}) {
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
  const routes = situationData?.state.routes ?? []
  const exposureData = getExposureOfRound(round.id)
  const reactions = composeData?.scene.reactions ?? []
  const setup = sceneData?.setup

  const typeCounts = (segmentsData?.segments ?? []).reduce<Record<string, number>>((acc, segment) => {
    acc[segment.kind] = (acc[segment.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <section
      className="round-block"
      id={`round-${round.id}`}
      data-round-block
      data-round-id={round.id}
      data-has-scene={setup && !setup.unchanged ? '1' : '0'}
    >
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
          {situationData.state.backstory?.trim() ? (
            <details className="situation-backstory" open>
              <summary>他们是怎么走到这一步的</summary>
              {situationData.state.backstory}
            </details>
          ) : null}

          {situationData.state.reason?.trim() ? (
            <details className="situation-reason">
              <summary>为什么是此刻</summary>
              {situationData.state.reason}
            </details>
          ) : null}

          {situationData.state.holdUp?.trim() ? (
            <details className="situation-reason">
              <summary>为什么这一轮没有更进一步</summary>
              {situationData.state.holdUp}
            </details>
          ) : null}

          {isRoundStalled(round, situationData.state) ? (
            <div className="situation-stalled">
              ⚠ 这一轮的分没有涨（{situationData.state.prevSexScore} → {situationData.state.sexScore}）
              —— 勾了快速模式却没主动引导，这轮不合格
            </div>
          ) : null}

          {/* 界面文案保持中性正式 —— 直白、粗俗的用词只出现在提示词里 */}
          {round.rating === 'r18' ? (
            <div className="situation-streak">
              成人向第 {situationData.state.r18Streak} 轮 · 性内容{' '}
              {situationData.state.sexScore >= 100
                ? `已经在做（第 ${Math.round((situationData.state.sexScore - 100) / 10) + 1} 轮）`
                : `${situationData.state.sexScore} / 100`}
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
      {!reactions.length && composeData && round.status === 'done' ? (
        // 这一轮跑完了，却一个角色都没有。可能是真的没人出场（独角戏），
        // 也可能是阵容解析空转了 —— 两种情况在数据上长得一样，界面上必须
        // 说一声，否则看起来就像"剧情断在局面这里"。
        <div className="round-empty-reactions">
          （这一轮没有角色出场 —— 阵容解析没有认出任何人。）
        </div>
      ) : null}
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

      {/* 可选方向放在**本轮最后** —— 用户一般是看完所有角色的演出之后才做选择。
          它也是唯一"面向未来"的字段：一旦有了下一轮，那个局面就过去了，
          再点会填进与当下不符的内容，所以只在最新一轮显示。 */}
      {isLast && routes.length ? (
        <div className="situation-routes">
          <div className="situation-routes-head">可选方向</div>
          {routes.map((route, index) => (
            <button
              key={index}
              className="situation-route"
              onClick={() =>
                // 每一条本身就是「用户视角、能直接发」的内容，所以只注入正文；
                // 标题已经在按钮上给他看过了
                useAppStore.getState().injectDraft(route.detail?.trim() || route.title)
              }
            >
              <span className="situation-route-title">▸ {route.title}</span>
              {route.detail ? <span className="situation-route-detail">{route.detail}</span> : null}
            </button>
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
  const steps = useAppStore((state) => state.steps)
  // 按场景分组（说明见 utils/sceneGroups）
  const sceneGroups = useMemo(() => groupRoundsByScene(rounds, steps), [rounds, steps])
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
      {sceneGroups.map((group) => (
        // 一个场景 = 一张卡 + 它覆盖的那些轮次。
        // 卡 sticky 在**这一组**里，所以它从场景开始一直粘到下一个场景出现，
        // 中途不会因为"换了一轮"就被推走 —— 只有真的换了场景，下一张卡才顶上来。
        <div className="scene-group" key={group.sceneRoundId}>
          {group.rounds.map((round, index) => (
            <Fragment key={round.id}>
              <RoundDivider round={round} />
              {/* 场景卡跟在它所属那一轮的分隔符后面 —— 分隔符是这一轮的标题，
                  场景是这一轮的内容。后面的轮次若沿用同一场景，就不再插卡。 */}
              {index === 0 && group.sceneRoundId ? (
                <SceneCard sceneRoundId={group.sceneRoundId} />
              ) : null}
              <RoundBlock
                round={round}
                isLast={round.id === rounds[rounds.length - 1]?.id}
                demo={demoParam()}
              />
            </Fragment>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
