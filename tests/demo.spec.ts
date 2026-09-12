import { describe, expect, it } from 'vitest'
import { seedDemoWorkspace } from '@/demo'
import { getCastLibrary, getMemories } from '@/engine/memory/library'
import type { ContextBundle, ComposedScene } from '@/types/character'
import type { PcExposure } from '@/types/exposure'

describe('演示模式（?demo=1）', () => {
  it('能跑出一份完整的两轮工作区，而且每个步骤都成功', async () => {
    const { snapshot } = await seedDemoWorkspace()

    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.rounds).toHaveLength(2)
    expect(snapshot.sessions[0].title).toBe('城南茶馆')

    const stages = new Set(Object.values(snapshot.steps).map((step) => step.stage))
    for (const stage of ['normalize', 'segment', 'scene', 'exposure', 'cast', 'context', 'roleplay', 'compose', 'commit']) {
      expect(stages).toContain(stage)
    }

    const failed = Object.values(snapshot.steps).filter((step) => step.status !== 'done')
    expect(failed.map((step) => `${step.label}: ${step.error}`)).toEqual([])
  })

  it('第二轮复用了第一轮的角色，并且带上了跨轮记忆', async () => {
    const { snapshot } = await seedDemoWorkspace()
    const roundIds = new Set(snapshot.rounds.map((round) => round.id))

    const library = getCastLibrary(snapshot.steps, { roundIds })
    expect(Object.values(library).map((card) => card.name).sort()).toEqual(['林砚', '阿七'])

    const memories = getMemories(snapshot.steps, { roundIds })
    expect(Object.keys(memories)).toHaveLength(2)

    const secondContext = Object.values(snapshot.steps).find(
      (step) => step.roundId === 'demo-r2' && step.stage === 'context',
    )
    const bundle = secondContext?.output as ContextBundle
    expect(bundle.recalled.length).toBeGreaterThan(0)
    expect(bundle.recalled[0].where).toContain('城南茶馆')
  })

  it('第二轮的时间线保住了「说一半 → 犹豫 → 再说」的顺序', async () => {
    const { snapshot } = await seedDemoWorkspace()

    const composeStep = Object.values(snapshot.steps).find(
      (step) => step.roundId === 'demo-r2' && step.stage === 'compose',
    )
    const scene = composeStep?.output as ComposedScene

    const mine = scene.blocks.filter((block) => block.kind.startsWith('pc-'))
    expect(mine.map((block) => block.kind)).toEqual(['pc-action', 'pc-speech', 'pc-cue', 'pc-speech', 'pc-action', 'pc-speech'])
    expect(mine.map((block) => block.text)).toEqual([
      '我坐下来，把伞靠在桌边。',
      '我其实。。。。',
      '话说了一半停下来，手指在伞柄上蹭了一下',
      '。。。。也没那么想回家。。。。',
      '（我看着他）',
      '我可以。。。。跟你待一会吗。',
    ])
  })

  it('你的真实内心不会出现在任何角色拿到的上下文里', async () => {
    const { snapshot } = await seedDemoWorkspace()

    const bundles = Object.values(snapshot.steps)
      .filter((step) => step.stage === 'context')
      .map((step) => JSON.stringify(step.output))

    // 第二轮那句「（我有点犹豫）」的原文与解读都不该外泄
    for (const serialized of bundles) {
      expect(serialized).not.toContain('我有点犹豫')
      expect(serialized).not.toContain('hidden')
    }

    // 但引擎侧完整保留，用来展示「别人眼里的你」
    const exposureStep = Object.values(snapshot.steps).find(
      (step) => step.roundId === 'demo-r2' && step.stage === 'exposure',
    )
    const exposure = exposureStep?.output as PcExposure
    expect(exposure.cues[0].hidden).toBe('（我有点犹豫）')
  })
})
