import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { latestR18Suggestion, runRoundFor } from './usePipelineActions'
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
  const draftInjection = useAppStore((state) => state.draftInjection)
  const [personaOpen, setPersonaOpen] = useState(false)
  // 延续上一次的勾选（存在 localStorage 里），红色够显眼，不用每次重勾
  // 勾选状态住在 store 里 —— 导演宣告成人向收尾时要能替用户关掉它
  const composer = useAppStore((state) => state.composer)
  const setComposer = useAppStore((state) => state.setComposer)
  const r18 = composer.rating === 'r18'
  const direct = composer.direct
  // 总闸关着的时候，哪怕勾选状态还留着也不生效 —— 免得出现"看不见但还在跑"的开关
  // 导演在最后一轮请求了开启成人向 —— 直接显示出来，别让用户猜
  const suggested = useAppStore(
    (state) => latestR18Suggestion(state.steps, state.rounds, state.activeSessionId)?.suggested ?? false,
  )

  const liveR18 = project.allowR18 && r18
  const liveDirect = liveR18 && direct

  const handleR18Change = (value: boolean) => {
    // 关掉 R18 时「让导演推进」自动失效 —— 它只在成人向那一轮有意义
    setComposer({ rating: value ? 'r18' : 'general', direct: value ? direct : false })
  }

  const handleDirectChange = (value: boolean) => {
    setComposer({ direct: value })
  }

  // 别处（比如导演推荐的方向）往这里塞文字时，填进输入框让用户过目、修改
  useEffect(() => {
    if (!draftInjection) return
    setDraft(draftInjection.text)
    setPersonaOpen(false)
  }, [draftInjection?.id])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || busy) return
    const round = newRound(text, liveR18 ? 'r18' : 'general', false, liveDirect)
    setDraft('')
    await runRoundFor(round.id)
  }

  /** 主动交棒：这一轮我什么都不做，让场面和角色自己往前走 */
  const handleIdle = async () => {
    if (busy) return
    const round = newRound(IDLE_INPUT, liveR18 ? 'r18' : 'general', true, liveDirect)
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

        {project.allowR18 ? (
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
          R18 模式
          {suggested ? (
            <span
              className="r18-suggest"
              title={
                '导演判断剧情走到这里、再纯情下去已经不合适了，建议开启成人向。\n' +
                '它已经替你勾上了 —— 不想往那边走就把勾去掉，' +
                '导演那一轮会照普通分级写。'
              }
            >
              导演建议
            </span>
          ) : null}
        </label>
        ) : null}

        {project.allowR18 && r18 ? (
          <label
            className={`r18-toggle ${direct ? 'on' : ''}`}
            title={
              '让导演推进：把推进的责任交给导演 —— 他会主动带节奏，\n' +
              '不必你自己一步步铺。\n' +
              '导演会更明确地安排进展，角色也会更放开一些\n' +
              '（模糊地带倾向成人向解释，但写死的人设底线不变）。\n' +
              '勾选会一直保留，直到你取消 R18。'
            }
          >
            <input
              type="checkbox"
              checked={direct}
              disabled={busy}
              onChange={(event) => handleDirectChange(event.target.checked)}
            />
            让导演推进
          </label>
        ) : null}

        <button className="btn" disabled={busy} onClick={() => setDraft(SAMPLE)} title="一段有具体演出的素材">
          示例：具体演出
        </button>
        <button className="btn" disabled={busy} onClick={() => setDraft(SAMPLE_OUTLINE)} title="一句概要，引擎会展开成场景">
          示例：概要
        </button>

        <div style={{ flex: 1 }} />
        <span className="hint">{draft.length} 字</span>
      </div>
    </div>
  )
}
