import { useState } from 'react'
import { explainLlmError, formatAdvice } from '@/engine/llm/errors'
import { llmClient } from '@/engine/llm/instance'
import { useAppStore } from '@/store/appStore'
import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  findImageProvider,
  findTextProvider,
} from '@/types/settings'

export default function SettingsDialog() {
  const llm = useAppStore((state) => state.llm)
  const project = useAppStore((state) => state.project)
  const image = useAppStore((state) => state.image)
  const setImage = useAppStore((state) => state.setImage)
  const setLlm = useAppStore((state) => state.setLlm)
  const setProject = useAppStore((state) => state.setProject)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const resetWorkspace = useAppStore((state) => state.resetWorkspace)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  /**
   * 测连通性，不看模型说了什么。
   *
   * 有两点是踩过坑的：
   * · **关掉思考模式**：DeepSeek 默认开着思考，思维链会把 max_tokens 吃光，
   *   回来的 content 是空的 —— 看着像失败，其实是配额被思考占满了。
   * · **不校验内容**：模型爱回什么回什么，只要 HTTP 通了、有东西回来就算成功。
   */
  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await llmClient.chat([{ role: 'user', content: '只回复两个字：可用' }], {
        maxTokens: 64,
        temperature: 0,
        thinking: false,
      })
      const content = result.content.trim()
      setTestResult(
        content
          ? `✅ 连接成功（${result.model}，${result.ms}ms）：${content.slice(0, 60)}`
          : `✅ 连接成功（${result.model}，${result.ms}ms），但这次没返回内容 —— 不影响使用，引擎不靠这一步的内容。`,
      )
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
          <h3 className="panel-title">文字模型</h3>

          <div className="field">
            <label>模型服务商</label>
            <select
              className="select"
              value={llm.provider}
              onChange={(event) => {
                const preset = findTextProvider(event.target.value)
                // 端点和模型名跟着服务商走 —— 不让用户手填，就不会填错
                setLlm({ provider: preset.id, baseUrl: preset.baseUrl, model: preset.model })
              }}
            >
              {TEXT_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="hint">
              目前只支持 {TEXT_PROVIDERS.map((item) => item.label).join('、')}。
              端点和模型名（{findTextProvider(llm.provider).model}）由它决定，不用你填。
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={llm.useJsonResponseFormat}
                onChange={(event) => setLlm({ useJsonResponseFormat: event.target.checked })}
              />
              使用 response_format: json_object
            </label>
            <span className="hint">
              让模型输出<strong>严格的 JSON</strong>：不加 ``` 围栏、不在前后夹解释文字。
              引擎自己也能容错解析（会从一堆废话里把 JSON 抠出来），所以这个参数是
              "让模型少犯错"，不是"不开就不行"。部分中转不支持它（会返回 400），
              引擎会自动降级重试一次，也可以在这里直接关掉。
            </span>
          </div>

          {llm.provider === 'deepseek' ? (
            <>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={llm.deepseekNoThinkingSimple}
                    onChange={(event) => setLlm({ deepseekNoThinkingSimple: event.target.checked })}
                  />
                  简单步骤不思考
                </label>
                <span className="hint">
                  <strong>拆解</strong>和<strong>信息分发</strong>这两步（判断"这句是台词还是动作"
                  "谁背对着谁"）用不上思维链，关掉明显变快。DeepSeek 的思考模式默认是开的，
                  所以引擎会在这些请求里带上 <code>{'{"thinking": {"type": "disabled"}}'}</code>。
                </span>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={llm.deepseekNoThinkingAll}
                    onChange={(event) => setLlm({ deepseekNoThinkingAll: event.target.checked })}
                  />
                  复杂步骤也不思考
                </label>
                <span className="hint">
                  连<strong>导演、角色、场景构建</strong>这些也一起关掉。会更快也更便宜，
                  但那些步骤本来就靠模型"想一想"才好看 —— 写出来可能更平、更套路。默认关着。
                </span>
              </div>
            </>
          ) : (
            <div className="field">
              <span className="hint">当前模型不是 DeepSeek，所以没有思考模式的开关。</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" disabled={testing} onClick={handleTest}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult ? <span className="hint">{testResult}</span> : null}
          </div>

          <div className="divider" />

          <h3 className="panel-title">生图模型</h3>

          <div className="field">
            <label>模型服务商</label>
            <select
              className="select"
              value={image.provider}
              onChange={(event) => setImage({ provider: event.target.value })}
            >
              {IMAGE_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="hint">
              目前只支持 {IMAGE_PROVIDERS.map((item) => item.label).join('、')}。
              模型名（{findImageProvider(image.provider).model}）和接口地址由它决定。
            </span>
          </div>

          <div className="field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              value={image.apiKey}
              placeholder="..."
              onChange={(event) => setImage({ apiKey: event.target.value })}
            />
            <span className="hint">同样是本地保存，不会发给任何第三方。</span>
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(image.autoGenerate)}
                onChange={(event) => setImage({ autoGenerate: event.target.checked })}
              />
              自动生图
            </label>
            <span className="hint">
              只要这一轮出现了<strong>新的场景</strong>（不是沿用上一个），就自动画一张。默认关 ——
              它会花钱，而且出图要等几秒。
            </span>
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
                checked={project.allowR18}
                onChange={(event) => {
                  const next = event.target.checked
                  setProject({ allowR18: next })
                  // 关掉总闸时把输入区的勾选一起复原 ——
                  // 否则它会变成一个看不见、却还在生效的开关
                  if (!next) useAppStore.getState().setComposer({ rating: 'general', direct: false })
                }}
              />
              允许使用成人向模式
            </label>
            <span className="hint">
              默认关闭。勾上之后，输入区才会出现<strong>「R18 模式」</strong>那个勾选框
              （以及它下面的「让导演推进」）。不勾这一项，界面上不会出现任何成人向相关的东西。
            </span>
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
            <span className="hint">时间跳跃时，推断每个角色这段时间各自的经历。</span>
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
