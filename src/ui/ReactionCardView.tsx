import { useState } from 'react'
import { TIER_LABEL, type ReactionCard } from '@/types/character'
import { getContextStepOf } from './usePipelineActions'
import ContextView from './ContextView'
import { useAppStore } from '@/store/appStore'

interface Props {
  roundId: string
  reaction: ReactionCard
  /** 演示模式用来让截图直接展示展开状态 */
  defaultOpenContext?: boolean
  defaultOpenInner?: boolean
}

export default function ReactionCardView({
  roundId,
  reaction,
  defaultOpenContext = false,
  defaultOpenInner = false,
}: Props) {
  const [showContext, setShowContext] = useState(defaultOpenContext)
  const [showInner, setShowInner] = useState(defaultOpenInner)
  const steps = useAppStore((state) => state.steps)
  void steps

  const contextStep = showContext ? getContextStepOf(roundId, reaction.characterId) : null
  const hasSpeech = reaction.beats.some((beat) => beat.kind === 'speech')

  return (
    <div className="reaction-card">
      <div className="reaction-head">
        <span className="avatar">{reaction.name.slice(0, 1)}</span>
        <span className="reaction-name">{reaction.name}</span>
        <span className="chip">{TIER_LABEL[reaction.tier]}</span>
        {reaction.mood ? <span className="chip">心境：{reaction.mood}</span> : null}
        {!hasSpeech ? <span className="chip chip-warn">这一轮没说话</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setShowContext((value) => !value)}>
          {showContext ? '收起上下文' : '它收到了什么'}
        </button>
      </div>

      {showContext ? (
        contextStep ? (
          <ContextView bundle={contextStep.output} roundId={roundId} />
        ) : (
          <div className="hint">找不到这一步的上下文记录（可能还没有跑完）。</div>
        )
      ) : null}

      <div className="beats">
        {reaction.beats.map((beat, index) => {
          if (beat.kind === 'speech') {
            return (
              <div key={index} className="beat beat-speech">
                <span className="beat-quote">「{beat.text}」</span>
                {beat.addressee?.length ? <span className="beat-tag">对 {beat.addressee.join('、')}</span> : null}
              </div>
            )
          }
          if (beat.kind === 'action') {
            return (
              <div key={index} className="beat beat-action">
                {beat.text}
              </div>
            )
          }
          return (
            <div key={index} className="beat beat-cue">
              <span className="beat-cue-mark">▸</span>
              {beat.text}
              <span className="beat-tag">可见线索</span>
            </div>
          )
        })}

        {!reaction.beats.length ? (
          <div className="beat beat-silence">
            （没有说话
            {reaction.silentReason ? `：${reaction.silentReason}` : ''}）
          </div>
        ) : null}
      </div>

      {reaction.inner ? (
        <div className="inner-toggle" onClick={() => setShowInner((value) => !value)}>
          {showInner ? (
            <>
              <span className="inner-label">它没说出口的（其他人看不到）</span>
              <span className="inner-text">{reaction.inner}</span>
            </>
          ) : (
            <span>▸ 它没说出口的（点击展开）</span>
          )}
        </div>
      ) : null}
    </div>
  )
}
