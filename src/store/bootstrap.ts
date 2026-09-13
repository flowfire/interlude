import { useAppStore } from './appStore'
import {
  loadImageSettings,
  loadLlmSettings,
  loadProjectSettings,
  saveImageSettings,
  saveLlmSettings,
  saveProjectSettings,
} from './localSettings'
import { loadWorkspace, saveWorkspace } from './workspacePersist'
import { migrateWorkspace } from './migrate'
import { seedDemoWorkspace } from '@/demo'

let started = false

export interface BootstrapOptions {
  /** 演示模式：用内置脚本跑出一份示例工作区，不读也不写本地存储 */
  demo?: boolean
}

/** 启动：载入设置与工作区，并挂上自动保存 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  const store = useAppStore.getState()

  if (options.demo) {
    const { snapshot, project } = await seedDemoWorkspace()
    store.setProject(project)
    store.loadSnapshot(snapshot)
    return
  }

  store.setLlm(loadLlmSettings())
  store.setImage(loadImageSettings())
  store.setProject(loadProjectSettings())

  const loaded = await loadWorkspace()
  // 加入「对话」概念之前的旧数据在这里收拢
  const { snapshot, migrated } = migrateWorkspace(loaded)
  store.loadSnapshot(snapshot)
  if (migrated) await saveWorkspace(snapshot)

  if (started) return
  started = true

  let timer: ReturnType<typeof setTimeout> | undefined
  useAppStore.subscribe((state, prev) => {
    if (state.llm !== prev.llm) saveLlmSettings(state.llm)
    if (state.image !== prev.image) saveImageSettings(state.image)
    if (state.project !== prev.project) saveProjectSettings(state.project)

    const workspaceChanged =
      state.sessions !== prev.sessions ||
      state.rounds !== prev.rounds ||
      state.steps !== prev.steps ||
      state.ledger !== prev.ledger
    if (!workspaceChanged) return

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const latest = useAppStore.getState()
      void saveWorkspace({
        sessions: latest.sessions,
        rounds: latest.rounds,
        steps: latest.steps,
        ledger: latest.ledger,
      })
    }, 600)
  })
}
