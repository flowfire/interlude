/**
 * 可选的文字模型服务商。
 *
 * 只列引擎**真的验证过**的那几家 —— 让用户选服务商而不是手填 baseUrl/model，
 * 是为了不把"端点写错、模型名写错"这类问题丢给用户。要加新的就加一条。
 */
export interface TextProviderPreset {
  id: string
  label: string
  baseUrl: string
  model: string
}

export const TEXT_PROVIDERS: TextProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
]

/**
 * 可选的生图模型服务商。
 *
 * 引擎目前还没有调用它 —— 配置先放在这儿，接入的时候直接用。
 */
export interface ImageProviderPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  /** 生成接口的相对路径 */
  endpoint: string
}

export const IMAGE_PROVIDERS: ImageProviderPreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax',
    // 实测：国内站的 key 在国际站（api.minimax.io）会报 2049 invalid api key，
    // 反过来也一样 —— 两家是分开的账号体系。这里用国内站。
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'image-01',
    endpoint: '/image_generation',
  },
]

export function findTextProvider(id: string): TextProviderPreset {
  return TEXT_PROVIDERS.find((item) => item.id === id) ?? TEXT_PROVIDERS[0]
}

export function findImageProvider(id: string): ImageProviderPreset {
  return IMAGE_PROVIDERS.find((item) => item.id === id) ?? IMAGE_PROVIDERS[0]
}

/** 生图模型的配置 */
export interface ImageSettings {
  /** 服务商 id，见 IMAGE_PROVIDERS */
  provider: string
  apiKey: string
  /**
   * 自动生图：只要出现了新的场景（不是"沿用上一个"的那种）就自动画一张。
   * 默认关 —— 它会花钱，而且不是每个人都想要。
   */
  autoGenerate?: boolean
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  provider: IMAGE_PROVIDERS[0].id,
  apiKey: '',
}

/** 模型接口配置 */
export interface LlmSettings {
  /** 服务商 id，见 TEXT_PROVIDERS —— 用户在界面上只选这个 */
  provider: string
  /** 由服务商决定；保留在设置里是因为客户端要用，但界面上不让手填 */
  baseUrl: string
  model: string
  apiKey: string
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
   * **简单步骤**（拆解、信息分发）关掉思考模式 —— 只对 DeepSeek 生效。
   *
   * "这句是台词还是动作""谁背对着谁"这类判断用不上思维链，关掉明显变快。
   */
  deepseekNoThinkingSimple: boolean
  /**
   * **复杂步骤**（导演、角色、场景构建……）也关掉思考模式 —— 只对 DeepSeek 生效。
   *
   * 会更快也更便宜，但那些步骤本来就靠模型"想一想"才好看，所以默认关着。
   */
  deepseekNoThinkingAll: boolean
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
  provider: TEXT_PROVIDERS[0].id,
  baseUrl: TEXT_PROVIDERS[0].baseUrl,
  model: TEXT_PROVIDERS[0].model,
  apiKey: '',
  temperaturePrecise: 0.2,
  temperatureCreative: 0.85,
  maxConcurrency: 4,
  timeoutMs: 120000,
  maxRetries: 2,
  useJsonResponseFormat: true,
  deepseekNoThinkingSimple: true,
  deepseekNoThinkingAll: false,
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
