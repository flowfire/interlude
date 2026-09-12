import { useState } from 'react'
import { explainLlmError, formatAdvice } from '@/engine/llm/errors'
import { llmClient } from '@/engine/llm/instance'
import { useAppStore } from '@/store/appStore'

export default function SettingsDialog() {
  const llm = useAppStore((state) => state.llm)
  const project = useAppStore((state) => state.project)
  const setLlm = useAppStore((state) => state.setLlm)
  const setProject = useAppStore((state) => state.setProject)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const resetWorkspace = useAppStore((state) => state.resetWorkspace)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await llmClient.chat([{ role: 'user', content: '回复两个字：可用' }], {
        maxTokens: 16,
        temperature: 0,
      })
      setTestResult(`✅ 连接成功（${result.model}，${result.ms}ms）：${result.content.trim().slice(0, 80)}`)
    } catch (error) {
      const advice = explainLlmError(error)
      setTestResult(`❌ ${formatAdvice(advice)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-mask" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setSettingsOpen(false)}>
            关闭
          </button>
        </div>

        <div className="modal-body">
          <h3 className="panel-title">模型接口（OpenAI 兼容）</h3>

          <div className="field">
            <label>接口地址 baseUrl</label>
            <input
              className="input"
              value={llm.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={(event) => setLlm({ baseUrl: event.target.value })}
            />
            <span className="hint">
              填到 /v1 为止即可，会自动拼 /chat/completions。DeepSeek、OpenAI、Kimi、Ollama、各类中转站都适用。
            </span>
          </div>

          <div className="field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              value={llm.apiKey}
              placeholder="sk-..."
              onChange={(event) => setLlm({ apiKey: event.target.value })}
            />
            <span className="hint">只保存在你自己浏览器的 localStorage 里，不会发往任何第三方服务器。</span>
          </div>

          <div className="field">
            <label>模型名</label>
            <input
              className="input"
              value={llm.model}
              placeholder="deepseek-chat"
              onChange={(event) => setLlm({ model: event.target.value })}
            />
          </div>

          <div className="row-2">
            <div className="field">
              <label>拆解温度（越低越稳定）</label>
              <input
                className="input"
                type="number"
                step="0.05"
                min="0"
                max="2"
                value={llm.temperaturePrecise}
                onChange={(event) => setLlm({ temperaturePrecise: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>扮演温度（越高越有发挥）</label>
              <input
                className="input"
                type="number"
                step="0.05"
                min="0"
                max="2"
                value={llm.temperatureCreative}
                onChange={(event) => setLlm({ temperatureCreative: Number(event.target.value) })}
              />
            </div>
          </div>

          <div className="row-2">
            <div className="field">
              <label>并发上限</label>
              <input
                className="input"
                type="number"
                min="1"
                max="16"
                value={llm.maxConcurrency}
                onChange={(event) => setLlm({ maxConcurrency: Math.max(1, Number(event.target.value) || 1) })}
              />
            </div>
            <div className="field">
              <label>超时（毫秒）</label>
              <input
                className="input"
                type="number"
                min="5000"
                step="1000"
                value={llm.timeoutMs}
                onChange={(event) => setLlm({ timeoutMs: Math.max(5000, Number(event.target.value) || 60000) })}
              />
            </div>
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={llm.useJsonResponseFormat}
                onChange={(event) => setLlm({ useJsonResponseFormat: event.target.checked })}
              />
              使用 response_format: json_object
            </label>
            <span className="hint">部分中转站不支持这个参数，引擎遇到 400 会自动降级重试，也可以在这里直接关掉。</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" disabled={testing} onClick={handleTest}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult ? <span className="hint">{testResult}</span> : null}
          </div>

          <div className="divider" />

          <h3 className="panel-title">故事设定</h3>

          <div className="row-2">
            <div className="field">
              <label>故事名</label>
              <input
                className="input"
                value={project.storyTitle}
                onChange={(event) => setProject({ storyTitle: event.target.value })}
              />
            </div>
            <div className="field">
              <label>你扮演的角色名</label>
              <input
                className="input"
                value={project.pcName}
                onChange={(event) => setProject({ pcName: event.target.value })}
              />
              <span className="hint">这个角色的台词会被自动锁定，AI 不能改写。</span>
            </div>
          </div>

          <div className="field">
            <label>演绎自由度</label>
            <select
              className="select"
              value={project.freedomLevel}
              onChange={(event) => setProject({ freedomLevel: event.target.value as typeof project.freedomLevel })}
            >
              <option value="low">低 —— 只对眼前的事做反应</option>
              <option value="medium">中 —— 会为自己的目标行动</option>
              <option value="high">高 —— 会主动把局面推向他要的方向</option>
            </select>
          </div>

          <div className="field">
            <label>误读强度</label>
            <select
              className="select"
              value={project.misreadLevel}
              onChange={(event) => setProject({ misreadLevel: event.target.value as typeof project.misreadLevel })}
            >
              <option value="low">低 —— 大体能读懂对方</option>
              <option value="medium">中 —— 常有偏差，但方向对</option>
              <option value="high">高 —— 经常鸡同鸭讲</option>
            </select>
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={project.researchEnabled}
                onChange={(event) => setProject({ researchEnabled: event.target.checked })}
              />
              给知名角色联网查资料（维基百科）
            </label>
            <span className="hint">
              只对<strong>这一轮新出场</strong>的角色查一次，免 key。网络不通或没有词条时会自动跳过，改用模型自身的知识。
              查到的资料会喂给角色卡生成，让金刚狼这种角色的性格不至于写得太空。
            </span>
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={project.interludeFill}
                onChange={(event) => setProject({ interludeFill: event.target.checked })}
              />
              自动补全幕间空白
            </label>
            <span className="hint">时间跳跃（比如「三天后」）时，自动推断这段时间里每个角色各自经历了什么。</span>
          </div>

          <div className="divider" />

          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('会清空所有轮次、步骤与记忆，确定吗？')) resetWorkspace()
            }}
          >
            清空工作区
          </button>
        </div>
      </div>
    </div>
  )
}
