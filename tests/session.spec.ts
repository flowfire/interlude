import { beforeEach, describe, expect, it } from 'vitest'
import { createStep } from '@/engine/graph/stepGraph'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_SESSION_TITLE } from '@/types/step'

describe('对话（会话）与轮次', () => {
  beforeEach(() => {
    useAppStore.getState().resetWorkspace()
  })

  it('直接发一轮就会自动开一条对话，同一对话内序号递增', () => {
    const first = useAppStore.getState().newRound('第一轮')
    const second = useAppStore.getState().newRound('第二轮')
    const state = useAppStore.getState()

    expect(state.sessions).toHaveLength(1)
    expect(first.sessionId).toBe(second.sessionId)
    expect(first.index).toBe(1)
    expect(second.index).toBe(2)
  })

  it('新建对话之后，轮次算在新对话里，序号重新从 1 开始', () => {
    const oldRound = useAppStore.getState().newRound('旧对话')
    const session = useAppStore.getState().newSession()
    const newRound = useAppStore.getState().newRound('新对话')

    expect(newRound.sessionId).toBe(session.id)
    expect(newRound.sessionId).not.toBe(oldRound.sessionId)
    expect(newRound.index).toBe(1)
    // 两条故事线互不影响
    expect(useAppStore.getState().rounds).toHaveLength(2)
  })

  it('从某一轮重演会作废它之后的所有轮次', () => {
    const first = useAppStore.getState().newRound('1')
    useAppStore.getState().newRound('2')
    useAppStore.getState().newRound('3')

    useAppStore.getState().truncateAfterRound(first.id)

    expect(useAppStore.getState().rounds.map((round) => round.id)).toEqual([first.id])
  })

  it('作废轮次时，它的步骤也一起被清掉', () => {
    const first = useAppStore.getState().newRound('1')
    const second = useAppStore.getState().newRound('2')

    const keep = createStep({ roundId: first.id, stage: 'normalize', label: '保留' })
    const drop = createStep({ roundId: second.id, stage: 'normalize', label: '丢弃' })
    useAppStore.getState().mergeSteps({ [keep.id]: keep, [drop.id]: drop })

    useAppStore.getState().truncateAfterRound(first.id)

    const steps = useAppStore.getState().steps
    expect(steps[keep.id]).toBeTruthy()
    expect(steps[drop.id]).toBeUndefined()
  })

  it('作废只发生在同一条故事线内，不会误伤另一条', () => {
    const a1 = useAppStore.getState().newRound('A1')
    useAppStore.getState().newRound('A2')
    useAppStore.getState().newSession()
    const b1 = useAppStore.getState().newRound('B1')

    useAppStore.getState().truncateAfterRound(a1.id)

    const ids = useAppStore.getState().rounds.map((round) => round.id)
    expect(ids).toContain(a1.id)
    expect(ids).toContain(b1.id)
    expect(ids).toHaveLength(2)
  })

  it('清掉某一轮的步骤时不会动别的轮次，轮次本身也还在', () => {
    const first = useAppStore.getState().newRound('1')
    const second = useAppStore.getState().newRound('2')

    const keep = createStep({ roundId: first.id, stage: 'normalize', label: '保留' })
    const drop = createStep({ roundId: second.id, stage: 'normalize', label: '清掉' })
    useAppStore.getState().mergeSteps({ [keep.id]: keep, [drop.id]: drop })

    useAppStore.getState().clearRoundSteps(second.id)

    const state = useAppStore.getState()
    expect(state.steps[keep.id]).toBeTruthy()
    expect(state.steps[drop.id]).toBeUndefined()
    // 轮次还在，只是变回「还没生成」的状态
    expect(state.rounds.map((round) => round.id)).toEqual([first.id, second.id])
    expect(state.rounds[1].status).toBe('draft')
    expect(state.rounds[1].stepIds).toEqual([])
  })

  it('丢弃轮次之前记下快照，可以整个撤销回来', () => {
    const first = useAppStore.getState().newRound('1')
    const second = useAppStore.getState().newRound('2')
    const third = useAppStore.getState().newRound('3')

    const step = createStep({ roundId: third.id, stage: 'normalize', label: '会被丢掉的步骤' })
    useAppStore.getState().mergeSteps({ [step.id]: step })

    useAppStore.getState().saveUndo('重演这一轮')
    useAppStore.getState().truncateAfterRound(first.id)
    expect(useAppStore.getState().rounds).toHaveLength(1)

    useAppStore.getState().undoLast()

    const restored = useAppStore.getState()
    expect(restored.rounds.map((round) => round.id)).toEqual([first.id, second.id, third.id])
    expect(restored.steps[step.id]).toBeTruthy()
    // 撤销用掉之后就不再提供
    expect(restored.undoSnapshot).toBeNull()
  })

  it('撤销也能恢复被删掉的整条对话', () => {
    const roundA = useAppStore.getState().newRound('A')
    const sessionB = useAppStore.getState().newSession()
    useAppStore.getState().newRound('B')

    useAppStore.getState().saveUndo('删除对话')
    useAppStore.getState().deleteSession(sessionB.id)
    expect(useAppStore.getState().sessions).toHaveLength(1)

    useAppStore.getState().undoLast()

    const restored = useAppStore.getState()
    expect(restored.sessions).toHaveLength(2)
    expect(restored.rounds).toHaveLength(2)
    expect(restored.rounds.map((round) => round.id)).toContain(roundA.id)
  })

  it('删除对话会连它的轮次一起清掉', () => {
    const sessionA = useAppStore.getState().sessions[0] ?? useAppStore.getState().newSession()
    const roundA = useAppStore.getState().newRound('A')
    const sessionB = useAppStore.getState().newSession()
    const roundB = useAppStore.getState().newRound('B')

    useAppStore.getState().deleteSession(sessionB.id)

    const state = useAppStore.getState()
    expect(state.rounds.map((round) => round.id)).toEqual([roundA.id])
    expect(state.activeSessionId).toBe(sessionA.id)
  })

  it('对话自动命名只在还没命名过时生效', () => {
    const session = useAppStore.getState().newSession()
    expect(session.title).toBe(DEFAULT_SESSION_TITLE)

    useAppStore.getState().autoTitleSession(session.id, '城南茶馆')
    expect(useAppStore.getState().sessions.find((item) => item.id === session.id)?.title).toBe('城南茶馆')

    // 已经起过名字就不再覆盖
    useAppStore.getState().autoTitleSession(session.id, '别的地方')
    expect(useAppStore.getState().sessions.find((item) => item.id === session.id)?.title).toBe('城南茶馆')
  })

  it('手工改名永远生效', () => {
    const session = useAppStore.getState().newSession()
    useAppStore.getState().autoTitleSession(session.id, '自动名')
    useAppStore.getState().renameSession(session.id, '我自己起的')
    expect(useAppStore.getState().sessions.find((item) => item.id === session.id)?.title).toBe('我自己起的')
  })
})
