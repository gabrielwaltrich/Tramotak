import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

type Tone = 'success' | 'error'
interface Toast {
  id: number
  tone: Tone
  message: string
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = nextId++
      setToasts((list) => [...list, { id, tone, message }])
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm shadow-lg"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 size={18} className="mt-px shrink-0 text-success" />
            ) : (
              <AlertCircle size={18} className="mt-px shrink-0 text-red-400" />
            )}
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-text" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
