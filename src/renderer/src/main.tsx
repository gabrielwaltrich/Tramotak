import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { ToastProvider } from './components/Toast'
import { applyStoredAppearance } from './theme'
import './styles/index.css'

applyStoredAppearance()

// Os dados são locais: sem refetch automático por foco ou retry de rede.
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, staleTime: Infinity } }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
)
