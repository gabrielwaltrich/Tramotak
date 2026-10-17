import { useEffect, useState } from 'react'
import type { PomodoroView } from '@shared/ipc'
import { remaining } from '@shared/pomodoro'

/**
 * Estado do Pomodoro (vem do processo principal) e o tempo que falta, atualizado a cada segundo enquanto roda.
 * O relógio é o mesmo computador, mas a diferença entre os dois processos é compensada mesmo assim.
 */
export function usePomodoro(): { view: PomodoroView | null; remainingMs: number } {
  const [view, setView] = useState<{ data: PomodoroView; offset: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const apply = (data: PomodoroView) => alive && setView({ data, offset: data.now - Date.now() })
    void window.api.pomodoro.get().then(apply)
    const off = window.api.pomodoro.onState(apply)
    return () => {
      alive = false
      off()
    }
  }, [])

  const running = view?.data.state.running ?? false
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [running])

  if (!view) return { view: null, remainingMs: 0 }
  return { view: view.data, remainingMs: remaining(view.data.state, now + view.offset) }
}
