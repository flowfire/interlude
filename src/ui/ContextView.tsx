import type { ReactNode } from 'react'
import { useAppStore } from '@/store/appStore'
import { SEGMENT_KIND_LABEL, type Segment } from '@/types/segment'
import { getComposeOfRound, getContextStepOf, getSegmentsOfRound } from './usePipelineActions'
import type { ContextBundle } from '@/types/character'

interface Props {
  bundle: ContextBundle
  roundId: string
}

const PUBLIC_KINDS = new Set(['scene', 'ambient', 'narration'])

/** 判断某条片段有没有进入这个角色的上下文 */
export function segmentGivenTo(segment: Segment, name: string): boolean {
  if (PUBLIC_KINDS.has(segment.kind)) return true
  if (segment.kind === 'worldfact' || segment.kind === 'offscreen') return true
  if (segment.kind === 'speech') return true
  if (segment.kind === 'action') return true
  if (segment.kind === 'inner') return Boolean(segment.subject?.includes(name))
  return false
}

function Section({ title, items, tone }: { title: string; items: ReactNode[]; tone?: string }) {
  if (!items.length) return null
  return (
    <div className="ctx-section">
      <h4 className={tone ? `ctx-title-${tone}` : undefined}>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export default function ContextView({ bundle, roundId }: Props) {
  const steps = useAppStore((state) => state.steps)
  void steps
  const segments = getSegmentsOfRound(roundId)?.segments ?? []
  const contextStep = getContextStepOf(roundId, bundle.characterId)
  const compose = getComposeOfRound(roundId)

  const givenCount = segments.filter((segment) => segmentGivenTo(segment, bundle.name)).length

  return (
    <div className="context-view">
      <div className="info-box" style={{ marginBottom: 12 }}>
        「{bundle.name}」这一轮拿到的信息 · {segments.length} 个片段中 {givenCount} 个给了它
      </div>

      <div className="ctx-section">
        <h4>往事</h4>
        {!bundle.history?.length ? (
          <div className="hint">还没有往事。</div>
        ) : (
          bundle.history.map((round) =>
            round.absent ? (
              <div key={round.index} className="ctx-history-round ctx-history-absent">
                <div className="ctx-round">
                  第 {round.index} 轮
                  {round.absentThrough && round.absentThrough > round.index
                    ? ` ~ 第 ${round.absentThrough} 轮`
                    : ''}
                  ：他不在场
                </div>
              </div>
            ) : (
            <div key={round.index} className="ctx-history-round">
              <div className="ctx-round">
                第 {round.index} 轮
                {[round.time, round.place].filter(Boolean).length
                  ? ` · ${[round.time, round.place].filter(Boolean).join(' · ')}`
                  : ''}
              </div>
              {round.sceneLines.map((line, index) => (
                <div key={index} className="ctx-event ctx-event-scene">
                  〔场景〕{line}
                </div>
              ))}
              {round.events.map((event, index) => (
                <div key={index} className={`ctx-event ctx-event-${event.kind}`}>
                  <span className="ctx-from">{event.from}</span>
                  {event.kind === 'speech' ? `「${event.text}」` : event.text}
                </div>
              ))}
              {round.inner ? <div className="ctx-inner">（他当时在想：{round.inner}）</div> : null}
            </div>
            ),
          )
        )}
      </div>

      <div className="ctx-section">
        <h4>这一轮他感知到的</h4>
        <ol className="ctx-timeline">
          {bundle.perceived.map((event, index) => (
            <li key={index} className={`ctx-event ctx-event-${event.kind}`}>
              <span className="ctx-from">{event.self ? '他自己' : event.from}</span>
              {event.kind === 'speech' ? `「${event.text}」` : event.text}
            </li>
          ))}
        </ol>
      </div>

      <Section title="场景与环境" items={bundle.sceneLines.map((line) => line)} />

      <Section
        title="他亲耳听到的话"
        items={bundle.heard.map((item) => (
          <>
            <span className="ctx-from">{item.from}</span>
            <span className="ctx-quote">「{item.text}」</span>
          </>
        ))}
      />

      <Section
        title="他看到的动作"
        items={bundle.seen.map((item) => (
          <>
            <span className="ctx-from">{item.subject}</span>
            {item.text}
          </>
        ))}
      />

      <Section
        title="他注意到的你的样子"
        items={bundle.pcCues.map((cue) => (
          <>
            {cue.visible}
            <span className="ctx-round">读出真实心情的概率 {Math.round(cue.readability * 100)}%</span>
          </>
        ))}
      />

      <Section
        title="他自己已经说过 / 做过的"
        items={bundle.ownPriorLines.map((line) => line)}
      />

      <Section title="他自己此刻在想什么" items={bundle.ownThoughts.map((line) => line)} tone="private" />

      <Section title="他本来就知道的背景" items={bundle.knownFacts.map((line) => line)} />

      <Section
        title="他确定不知道的事"
        items={(bundle.doesNotKnow.length ? bundle.doesNotKnow : ['（没有额外限制）']).map((line) => line)}
        tone="blocked"
      />

      {compose ? (
        <div className="ctx-section">
          <h4>场上还有谁</h4>
          <div className="hint">{bundle.presentNames.filter((name) => name !== bundle.name).join('、') || '只有他一个'}</div>
        </div>
      ) : null}

      <div className="ctx-section">
        <h4>原文去向</h4>
        <div className="ctx-seg-list">
          {segments.map((segment) => {
            const given = segmentGivenTo(segment, bundle.name)
            return (
              <div key={segment.id} className={`ctx-seg ${given ? 'given' : 'not-given'}`}>
                <span className={`chip kind-${segment.kind}`}>{SEGMENT_KIND_LABEL[segment.kind]}</span>
                <span className="ctx-seg-text">{segment.text}</span>
                <span className="ctx-seg-flag">{given ? '已给他' : '没给他'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
