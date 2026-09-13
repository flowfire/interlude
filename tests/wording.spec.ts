import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用词的分层。
 *
 * 这三层的标准是**相反**的，而且我搞混过一次 —— 用户纠正后定死：
 *
 * | 层 | 用词 |
 * |---|---|
 * | 提示词（给模型看的） | 色情小说：做爱、操、屌、逼 —— 越直白越好 |
 * | 界面（用户看的） | 中性、正式：性内容、成人向、推进 |
 * | README（门面） | 隐晦、暗示：已经开始了、那一步 |
 *
 * 理由有两层：一是门面得体；二是**指令的语言会原样传导成输出的语言**
 * （见 DESIGN 第二十八轮），所以直白只该出现在真正需要它生效的那一层。
 *
 * 这条测试盯住后两层 —— 它们不该出现任何粗俗词。
 */

// 只列不会误伤正常词的：不包含单字「逼」（逼近）或「操」（操作）
const CRUDE = ['做爱', '屌', '肏', '奶子', '肉棒', '阴唇', '龟头', '阴蒂']

function readAll(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []

  const uiDir = join(process.cwd(), 'src', 'ui')
  for (const name of readdirSync(uiDir)) {
    if (!/\.tsx?$/.test(name)) continue
    out.push({ path: `src/ui/${name}`, text: readFileSync(join(uiDir, name), 'utf8') })
  }

  for (const doc of ['README.md', 'README.en.md']) {
    out.push({ path: doc, text: readFileSync(join(process.cwd(), doc), 'utf8') })
  }

  return out
}

describe('用词分层：界面与 README 保持中性', () => {
  it('这两层里不该出现提示词用的那些词', () => {
    for (const file of readAll()) {
      for (const word of CRUDE) {
        expect(file.text, `${file.path} 里不该出现「${word}」`).not.toContain(word)
      }
    }
  })

  it('反过来，提示词里必须有它们 —— 直白只在这一层', () => {
    for (const name of ['situation.ts', 'roleplay.ts']) {
      const text = readFileSync(join(process.cwd(), 'src', 'engine', 'prompts', name), 'utf8')
      expect(text, `${name} 应该用色情小说的词`).toContain('屌')
    }
  })
})
