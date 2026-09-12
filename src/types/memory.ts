/** 一个角色在某一段经历里留下的记忆 */
export interface MemoryEntry {
  id: string
  characterId: string
  roundId: string
  roundIndex: number
  at: string
  /** 场面定位，例如「城南茶馆 · 傍晚」 */
  where: string
  /** 一句话概括这一轮从他视角发生了什么 */
  summary: string
  details: {
    /** 他当时看到的场景 */
    scene: string[]
    /** 他亲耳听到的话 */
    heard: string[]
    /** 他自己说过的话 */
    said: string[]
    /** 他自己做过的动作 */
    did: string[]
    /** 他当时从对方身上注意到的样子（外化线索） */
    noticed: string[]
  }
  /** 他当时的心境 */
  mood?: string
  /** 他当时在想什么（只有他自己能回忆起这一段） */
  inner?: string
}
