import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { loadComposerState, saveComposerState } from '@/store/localSettings'
import { runRoundFor } from './usePipelineActions'
import { IDLE_INPUT } from '@/types/step'

const SAMPLE = `三天后，傍晚。雨刚停，青石板上还积着水洼。
我推门进了城南那家茶馆，袖子湿了半截。
我说：「你来得比我预想的早。」
林砚抬眼看我，笑了一下，说：「路上耽搁了。」
我心里想，他果然还是不想让我看出什么。
柜台后面的阿七擦着杯子，一直没抬头。`

const SAMPLE_OUTLINE = `（我遇到了金刚狼）`

export default function InputBar() {
  const newRound = useAppStore((state) => state.newRound)
  const busy = useAppStore((state) => state.busy)
  const project = useAppStore((state) => state.project)
  const setProject = useAppStore((state) => state.setProject)

  const [draft, setDraft] = useState('')
  const [personaOpen, setPersonaOpen] = useState(false)
  // 延续上一次的勾选（存在 localStorage 里），红色够显眼，不用每次重勾
  const [r18, setR18] = useState(() => loadComposerState().rating === 'r18')

  const handleR18Change = (value: boolean) => {
    setR18(value)
    saveComposerState({ rating: value ? 'r18' : 'general' })
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || busy) return
    const round = newRound(text, r18 ? 'r18' : 'general')
    setDraft('')
    await runRoundFor(round.id)
  }

  /** 主动交棒：这一轮我什么都不做，让场面和角色自己往前走 */
  const handleIdle = async () => {
    if (busy) return
    const round = newRound(IDLE_INPUT, r18 ? 'r18' : 'general', true)
    await runRoundFor(round.id)
  }

  return (
    <div className="composer">
      <div className="persona-row">
        <button className="btn btn-sm btn-ghost" onClick={() => setPersonaOpen((value) => !value)}>
          {personaOpen ? '▾' : '▸'} 我自己的人设
        </button>
        {!personaOpen ? (
          <span className="hint persona-preview">
            {project.pcPersona.trim() ? project.pcPersona.trim().slice(0, 60) : '还没写'}
          </span>
        ) : null}
      </div>

      {personaOpen ? (
        <textarea
          className="textarea persona-input"
          rows={4}
          placeholder={
            '你是谁：身份、年龄感、外貌、穿着\n你是什么样的人：性格、说话习惯、在乎什么\n此刻的状态：心情、身上带着什么、刚经历过什么'
          }
          value={project.pcPersona}
          onChange={(event) => setProject({ pcPersona: event.target.value })}
        />
      ) : null}

      <textarea
        className="textarea"
        rows={3}
        placeholder={
          '这一轮发生了什么。具体演出、一句概要都可以。\n按 Ctrl/⌘ + Enter 发送'
        }
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSend()
          }
        }}
      />

      <div className="composer-actions">
        <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void handleSend()}>
          {busy ? '生成中…' : '发送'}
        </button>

        <button
          className="btn btn-idle"
          disabled={busy}
          onClick={() => void handleIdle()}
          title={'这一轮我什么都不做，把主动权交给场面和其他角色。\n导演会收到这个信号，让剧情往前走一大步。'}
        >
          什么都不做
        </button>

        <label
          className={`r18-toggle ${r18 ? 'on' : ''}`}
          title={
            '这一轮往成人向推进。\n' +
            '性格、说话方式、关系阶段不变，也不会一步到位。\n' +
            '勾选会一直保留，直到你取消。'
          }
        >
          <input
            type="checkbox"
            checked={r18}
            disabled={busy}
            onChange={(event) => handleR18Change(event.target.checked)}
          />
          R18 倾向
        </label>

        <button className="btn" disabled={busy} onClick={() => setDraft(SAMPLE)} title="一段有具体演出的素材">
          示例：具体演出
        </button>
        <button className="btn" disabled={busy} onClick={() => setDraft(SAMPLE_OUTLINE)} title="一句概要，引擎会展开成场面">
          示例：概要
        </button>

        <div style={{ flex: 1 }} />
        <span className="hint">{draft.length} 字</span>
      </div>
    </div>
  )
}
