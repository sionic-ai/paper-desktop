import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './style.css'
import { App } from './App'
import { applyTheme, initialTheme } from './theme'

// Before the first paint, so a dark-mode reader never sees a white flash.
applyTheme(initialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
