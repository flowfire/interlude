import { LlmClient } from './client'
import { useAppStore } from '@/store/appStore'

/** 全局唯一的模型客户端；设置随时改，取用时实时读取 */
export const llmClient = new LlmClient(() => useAppStore.getState().llm)
