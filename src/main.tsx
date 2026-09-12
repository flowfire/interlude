import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { bootstrap } from './store/bootstrap'

const params = new URLSearchParams(window.location.search)
const isDemo = params.get('demo') !== null

bootstrap({ demo: isDemo })
  .catch((err) => {
    console.error('[interlude] bootstrap 失败', err)
  })
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )

    // 演示模式支持用 #round-xxx 直接定位到某一轮，方便截图
    if (isDemo && window.location.hash) {
      setTimeout(() => {
        document.querySelector(window.location.hash)?.scrollIntoView({ block: 'start' })
      }, 400)
    }
  })
