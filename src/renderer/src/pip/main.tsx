import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PipApp } from './PipApp'
import '../styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PipApp />
  </StrictMode>
)
