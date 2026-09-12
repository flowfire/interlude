import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import App from '@/App'

describe('界面冒烟', () => {
  it('空状态下 App 能完整渲染，不抛错', () => {
    const html = renderToString(createElement(App))
    expect(html).toContain('幕间')
    // 输入区在底部，并且带「我自己的人设」入口
    expect(html).toContain('我自己的人设')
    expect(html).toContain('发送')
    expect(html).toContain('示例：概要')
    // 还没有轮次时给出引导
    expect(html).toContain('还没有开始')
  })
})
