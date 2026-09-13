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
  /**
   * 简单步骤（拆解、信息分发）关掉思考模式 —— **只对 DeepSeek 生效**。
   *
   * DeepSeek 的思考模式默认是开的，而"这句是台词还是动作""谁背对着谁"
   * 这类判断并不需要它；关掉能明显变快。其它服务商的字段各家不同，
   * 引擎不猜也不碰。
   */
  deepseekNoThinking: boolean
}

/**
 * 这个模型是不是 DeepSeek 家的。
 *
 * 只有 DeepSeek 才有「关掉思考模式」这个我们认得的开关 ——
 * 其它服务商的字段各家不同，引擎不猜也不碰，界面上也就不露那一项。
 */
export function isDeepSeekModel(model: string): boolean {
  return /^deepseek/i.test((model || '').trim())
}

/** 项目级设定 */
export interface ProjectSettings {
  /** 你扮演的角色名。等于它的台词会被自动锁定，AI 不可改写 */
  pcName: string
  /** 你自己的设定：身份、性格、外貌、此刻的状态……会注入每个阶段 */
  pcPersona: string
  storyTitle: string
  /** 演绎自由度：角色能在多大程度上为自己的目标行动、推动局面 */
  freedomLevel: 'low' | 'medium' | 'high'
  /** 时间跳跃时是否自动补全各角色在空白期的经历 */
  interludeFill: boolean
  /**
   * 允许使用成人向模式。
   *
   * 默认关闭 —— 开了之后输入区才会出现「R18 模式」那个勾选框。
   * 这是场外的总闸：不勾它，界面上根本看不到成人向相关的任何东西。
   */
  allowR18: boolean
  /** 给知名角色联网查资料（维基百科，免 key；失败静默跳过） */
  researchEnabled: boolean
  /** 误读强度：角色之间理解偏差的程度 */
  misreadLevel: 'low' | 'medium' | 'high'
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-flash',
  temperaturePrecise: 0.2,
  temperatureCreative: 0.85,
  maxConcurrency: 4,
  timeoutMs: 120000,
  maxRetries: 2,
  useJsonResponseFormat: true,
  deepseekNoThinking: true,
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  pcName: '我',
  pcPersona: '',
  storyTitle: '未命名故事',
  freedomLevel: 'medium',
  interludeFill: true,
  allowR18: false,
  researchEnabled: true,
  misreadLevel: 'medium',
}
