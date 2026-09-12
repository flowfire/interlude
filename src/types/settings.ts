/** 模型接口配置 */
export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
  /** 拆解 / 编排这类需要稳定的任务 */
  temperaturePrecise: number
  /** 角色扮演这类需要发挥的任务 */
  temperatureCreative: number
  maxConcurrency: number
  timeoutMs: number
  maxRetries: number
  /** 是否请求 response_format: json_object（部分厂商不支持） */
  useJsonResponseFormat: boolean
}

/** 项目级设定 */
export interface ProjectSettings {
  /** 你扮演的角色名。等于它的台词会被自动锁定，AI 不可改写 */
  pcName: string
  /** 你自己的设定：身份、性格、外貌、此刻的状态……会注入每个阶段 */
  pcPersona: string
  storyTitle: string
  /** 演绎自由度：AI 可以在多大程度上改写非锁定内容 */
  freedomLevel: 'low' | 'medium' | 'high'
  /** 时间跳跃时是否自动补全各角色在空白期的经历 */
  interludeFill: boolean
  /** 给知名角色联网查资料（维基百科，免 key；失败静默跳过） */
  researchEnabled: boolean
  /** 误读强度：角色之间理解偏差的程度 */
  misreadLevel: 'low' | 'medium' | 'high'
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperaturePrecise: 0.2,
  temperatureCreative: 0.85,
  maxConcurrency: 4,
  timeoutMs: 120000,
  maxRetries: 2,
  useJsonResponseFormat: true,
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  pcName: '我',
  pcPersona: '',
  storyTitle: '未命名故事',
  freedomLevel: 'medium',
  interludeFill: true,
  researchEnabled: true,
  misreadLevel: 'medium',
}
