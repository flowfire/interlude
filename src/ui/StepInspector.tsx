import { useEffect, useState } from 'react'
import { collectDownstream } from '@/engine/graph/stepGraph'
import { useAppStore } from '@/store/appStore'
import { STAGE_LABEL } from '@/types/step'
import { rerunStep } from './usePipelineActions'

type Tab = 'output' | 'input' | 'edit'

export default function StepInspector() {
  const stepId = useAppStore((state) => state.inspectorStepId)
  const step = useAppStore((state) => (state.inspectorStepId ? state.steps[state.inspectorStepId] : undefined))
  const steps = useAppStore((state) => state.steps)
  const setInspector = useAppStore((state) => state.setInspector)
  const updateStepOutput = useAppStore((state) => state.updateStepOutput)
  const toggleStepLock = useAppStore((state) => state.toggleStepLock)
  const busy = useAppStore((state) => state.busy)

  const [tab, setTab] = useState<Tab>('output')
  const [draft, setDraft] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(JSON.stringify(step?.output ?? null, null, 2))
    setParseError(null)
    setTab('output')
    // 只在该步骤切换时重置草稿，避免覆盖正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  if (!step) return null

  const downstream = collectDownstream(steps, step.id)

  const handleSave = () => {
    try {
      const parsed = JSON.parse(draft)
      updateStepOutput(step.id, parsed)
      setParseError(null)
      setTab('output')
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="modal-mask" onClick={() => setInspector(null)}>
      <div className="modal" style={{ maxWidth: 860 }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {step.label}
            <span className="hint" style={{ marginLeft: 10 }}>
              {STAGE_LABEL[step.stage]} · {step.model ?? '本地计算'}
            </span>
          </h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setInspector(null)}>
            关闭
          </button>
        </div>

        <div className="modal-body">
          <div className="step-toolbar">
            <button className={`btn btn-sm ${tab === 'output' ? 'btn-primary' : ''}`} onClick={() => setTab('output')}>
              产物
            </button>
            <button className={`btn btn-sm ${tab === 'input' ? 'btn-primary' : ''}`} onClick={() => setTab('input')}>
              它当时收到的输入
            </button>
            <button className={`btn btn-sm ${tab === 'edit' ? 'btn-primary' : ''}`} onClick={() => setTab('edit')}>
              编辑
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => toggleStepLock(step.id)}>
              {step.lockedByUser ? '解除锁定' : '锁定这一步'}
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void rerunStep(step.id)}>
              从这一步重跑
            </button>
          </div>

          {tab === 'output' ? (
            <pre className="code">{JSON.stringify(step.output, null, 2)}</pre>
          ) : null}

          {tab === 'input' ? <pre className="code">{JSON.stringify(step.inputSnapshot, null, 2)}</pre> : null}

          {tab === 'edit' ? (
            <>
              <div className="info-box">
                直接改这里的 JSON 就等于手工接管这一步。保存后，它下游的 {downstream.length} 个步骤会被标记为「已过期」，
                你可以选择只重跑受影响的那条分支。
              </div>
              {parseError ? <div className="error-box">JSON 解析失败：{parseError}</div> : null}
              <textarea
                className="textarea"
                rows={18}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={handleSave}>
                  保存并作废下游
                </button>
                <button className="btn" onClick={() => setDraft(JSON.stringify(step.output, null, 2))}>
                  还原
                </button>
              </div>
            </>
          ) : null}

          <div className="divider" />
          <div className="hint">
            下游步骤 {downstream.length} 个
            {downstream.length ? `：${downstream.map((id) => steps[id]?.label ?? id).join('、')}` : '（这一步是末端）'}
            {' · '}
            耗时 {step.cost?.ms ?? 0} ms
            {step.cost?.calls ? ` · ${step.cost.calls} 次调用 · 输入 ${step.cost.tokensIn} / 输出 ${step.cost.tokensOut} tokens` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
