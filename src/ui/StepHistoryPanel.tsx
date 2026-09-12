import { useState } from 'react'
import { sumCost } from '@/engine/graph/stepGraph'
import { getCastLibrary, getMemories } from '@/engine/memory/library'
import { useAppStore } from '@/store/appStore'
import { SOURCE_LABEL, type CharacterCard } from '@/types/character'
import type { MemoryEntry } from '@/types/memory'
import { STAGE_LABEL, type Step } from '@/types/step'
import { formatDateTime } from '@/utils/time'
import { rerunStep } from './usePipelineActions'

function Bullets({ title, values, tone }: { title: string; values?: string[]; tone?: string }) {
  if (!values?.length) return null
  return (
    <div className="card-block">
      <h5 className={tone ? `card-block-${tone}` : undefined}>{title}</h5>
      <ul>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

function CharacterCardView({ card, memories }: { card: CharacterCard; memories: MemoryEntry[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="memory-card">
      <div className="memory-card-head" onClick={() => setOpen((value) => !value)}>
        <span className="avatar">{card.name.slice(0, 1)}</span>
        <span style={{ flex: 1 }}>{card.name}</span>
        {card.canonical ? (
          <span className="chip chip-warn" title={card.franchise || '知名角色'}>
            {card.franchise || '知名角色'}
          </span>
        ) : null}
        <span className="chip" title="人设依据">
          {SOURCE_LABEL[card.source] ?? card.source}
        </span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </div>

      <div className="hint memory-summary">{card.persona.summary}</div>

      {open ? (
        <div className="card-detail">
          <Bullets title="标志性特征" values={card.persona.signature} />
          <Bullets title="说话方式参考" values={card.persona.voiceSamples} />
          <Bullets title="原作里确定的事实" values={card.persona.canonAnchors} />
          <Bullets title="绝不会做的事" values={card.persona.boundaries} tone="blocked" />
          {card.persona.speechStyle ? (
            <div className="card-block">
              <h5>说话风格</h5>
              <div className="hint">{card.persona.speechStyle}</div>
            </div>
          ) : null}
          {card.persona.background ? (
            <div className="card-block">
              <h5>背景</h5>
              <div className="hint">{card.persona.background}</div>
            </div>
          ) : null}
          {card.researchNote ? (
            <div className="card-block">
              <h5>查到过的资料</h5>
              <div className="hint">{card.researchNote.slice(0, 400)}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {memories.length ? (
        <div className="memory-list">
          {memories.slice(-3).map((memory) => (
            <div key={memory.id} className="memory-item">
              <span className="ctx-round">第 {memory.roundIndex} 轮</span>
              {memory.summary}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function statusDot(status: Step['status']): string {
  if (status === 'done') return 'dot-done'
  if (status === 'running') return 'dot-running'
  if (status === 'error') return 'dot-error'
  if (status === 'stale') return 'dot-stale'
  return 'dot-pending'
}

function statusLabel(status: Step['status']): string {
  if (status === 'done') return '已完成'
  if (status === 'running') return '进行中'
  if (status === 'error') return '失败'
  if (status === 'stale') return '已过期'
  return '待执行'
}

function summarize(step: Step): string {
  if (step.stage === 'segment') {
    const output = step.output as { segments?: unknown[]; usedModel?: boolean } | null
    if (output?.segments) return `${output.segments.length} 个片段 · ${output.usedModel ? '模型' : '规则'}`
  }
  if (step.stage === 'normalize') {
    const output = step.output as { blocks?: unknown[]; timeMarkerHits?: unknown[] } | null
    if (output?.blocks) return `${output.blocks.length} 个文本块`
  }
  if (step.stage === 'scene') {
    const output = step.output as { place?: string; present?: unknown[]; inputMode?: string } | null
    if (output?.present) return `${output.inputMode ?? ''} · ${output.place || '地点未定'} · 在场 ${output.present.length} 人`
  }
  if (step.stage === 'cast') {
    const output = step.output as { characters?: unknown[]; reusedCount?: number } | null
    if (output?.characters) {
      const reused = output.reusedCount ?? 0
      return `${output.characters.length} 张角色卡${reused ? ` · 复用 ${reused}` : ''}`
    }
  }
  if (step.stage === 'roleplay') {
    const output = step.output as { beats?: { kind: string }[]; inner?: string } | null
    if (output?.beats) {
      const speech = output.beats.filter((beat) => beat.kind === 'speech').length
      return `${output.beats.length} 个节拍 · ${speech} 句台词`
    }
  }
  if (step.stage === 'commit') {
    const output = step.output as { entries?: unknown[] } | null
    if (output?.entries) return `${output.entries.length} 条记忆`
  }
  if (step.stage === 'context') {
    const output = step.output as { recalled?: unknown[]; heard?: unknown[] } | null
    if (output) return `记得 ${output.recalled?.length ?? 0} 段 · 听到 ${output.heard?.length ?? 0} 句`
  }
  return ''
}

export default function StepHistoryPanel() {
  const steps = useAppStore((state) => state.steps)
  const rounds = useAppStore((state) => state.rounds)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const selectedStepId = useAppStore((state) => state.selectedStepId)
  const selectStep = useAppStore((state) => state.selectStep)
  const setInspector = useAppStore((state) => state.setInspector)
  const toggleStepLock = useAppStore((state) => state.toggleStepLock)
  const busy = useAppStore((state) => state.busy)

  const [openRoundId, setOpenRoundId] = useState<string | null>(null)
  // 只看当前这条对话 —— 角色库与记忆也是按对话隔离的
  const sessionRounds = rounds.filter((round) => round.sessionId === activeSessionId)
  const roundIds = new Set(sessionRounds.map((round) => round.id))
  const latestRoundId = sessionRounds.length ? sessionRounds[sessionRounds.length - 1].id : null
  const effectiveOpen = openRoundId ?? latestRoundId

  const library = getCastLibrary(steps, { roundIds })
  const memories = getMemories(steps, { roundIds })

  return (
    <div className="side-col">
      <div className="side-section">
        <h3 className="panel-title">
          步骤历史
          <span className="hint">每一步都能编辑后重跑</span>
        </h3>

        {!sessionRounds.length ? (
          <div className="hint">这条对话还没有产生任何步骤。</div>
        ) : (
          [...sessionRounds].reverse().map((round) => {
            const own = Object.values(steps)
              .filter((step) => step.roundId === round.id)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            const cost = sumCost(steps, round.id)
            const open = effectiveOpen === round.id

            return (
              <div key={round.id} className="history-group">
                <div className="history-group-head" onClick={() => setOpenRoundId(open ? '' : round.id)}>
                  <span className="chev">{open ? '▾' : '▸'}</span>
                  <span style={{ flex: 1 }}>第 {round.index} 轮</span>
                  <span className="hint">{own.length} 步</span>
                </div>

                {open ? (
                  <div className="history-group-body">
                    {own.map((step) => {
                      const selected = selectedStepId === step.id
                      return (
                        <div
                          key={step.id}
                          className={`step-item ${selected ? 'selected' : ''} ${step.status === 'stale' ? 'stale' : ''}`}
                        >
                          <div className="step-head" onClick={() => selectStep(selected ? null : step.id)}>
                            <span className={`dot ${statusDot(step.status)}`} />
                            <span className="step-label">{step.label}</span>
                            {step.lockedByUser ? <span className="chip chip-locked">锁</span> : null}
                            {step.editedByUser ? <span className="chip">改</span> : null}
                          </div>

                          {selected ? (
                            <div className="step-body">
                              <div className="step-toolbar">
                                <button className="btn btn-sm" onClick={() => setInspector(step.id)}>
                                  查看输入/输出
                                </button>
                                <button className="btn btn-sm" onClick={() => toggleStepLock(step.id)}>
                                  {step.lockedByUser ? '解除锁定' : '锁定这一步'}
                                </button>
                                <button
                                  className="btn btn-sm btn-primary"
                                  disabled={busy}
                                  onClick={() => void rerunStep(step.id)}
                                  title="这一步以及它下游的内容会重新生成"
                                >
                                  从这一步重跑
                                </button>
                              </div>

                              <dl className="kv">
                                <dt>阶段</dt>
                                <dd>{STAGE_LABEL[step.stage]}</dd>
                                <dt>状态</dt>
                                <dd>{statusLabel(step.status)}</dd>
                                <dt>摘要</dt>
                                <dd>{summarize(step) || '—'}</dd>
                                <dt>模型</dt>
                                <dd>{step.model ?? '（本地计算）'}</dd>
                                <dt>耗时</dt>
                                <dd>{step.cost ? `${step.cost.ms} ms` : '—'}</dd>
                                <dt>时间</dt>
                                <dd>{formatDateTime(step.updatedAt)}</dd>
                                {step.error ? (
                                  <>
                                    <dt>错误</dt>
                                    <dd style={{ color: 'var(--red)' }}>{step.error}</dd>
                                  </>
                                ) : null}
                              </dl>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}

                    <div className="hint" style={{ padding: '4px 6px' }}>
                      {cost.calls} 次调用 · {cost.tokensIn + cost.tokensOut} tokens
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <div className="side-section">
        <h3 className="panel-title">
          角色与记忆
          <span className="hint">跨轮累积</span>
        </h3>
        {!Object.keys(library).length ? (
          <div className="hint">还没有出场过的角色。</div>
        ) : (
          Object.values(library).map((card) => (
            <CharacterCardView key={card.id} card={card} memories={memories[card.id] ?? []} />
          ))
        )}
      </div>

      <div className="side-section">
        <h3 className="panel-title">每一步都能重跑</h3>
        <div className="hint" style={{ lineHeight: 1.9 }}>
          一轮会拆成：规范化 → 拆解 → 场景构建 → 阵容解析 → 每个角色各自的上下文 → 各自反应 → 编排 → 记忆回写。
          <br />
          <br />
          改任意一步并重跑，<strong style={{ color: 'var(--text-dim)' }}>只有它下游的分支会重新生成</strong>
          。角色库和记忆都是从步骤派生的，所以回退时它们会跟着一起回退。
        </div>
      </div>
    </div>
  )
}
