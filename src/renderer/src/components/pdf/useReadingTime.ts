import { useEffect, useRef } from 'react'

const TICK_SEC = 5
/** Sem mexer no mouse, teclado ou rolagem por esse tempo, a leitura para de contar. */
const IDLE_MS = 90_000
const SAVE_EVERY_SEC = 30

/**
 * Tempo de estudo lendo um PDF: conta enquanto a janela está visível, em foco e com alguma atividade recente.
 * Envia a cada 30 s e ao sair. `getPosition` dá a página a guardar (`null` = só o tempo, ex.: anexo de um vídeo).
 */
export function useReadingTime(lessonId: number, getPosition: () => number | null): void {
  const position = useRef(getPosition)
  useEffect(() => {
    position.current = getPosition
  })

  useEffect(() => {
    let lastActivity = Date.now()
    let pending = 0
    let sinceSave = 0
    const flush = () => {
      void window.api.progress.save({ lessonId, positionSec: position.current(), durationSec: null, watchedSec: pending }).catch(() => {})
      pending = 0
      sinceSave = 0
    }
    const active = () => (lastActivity = Date.now())
    const events = ['pointermove', 'wheel', 'keydown', 'scroll'] as const
    for (const e of events) window.addEventListener(e, active, { capture: true, passive: true })
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastActivity < IDLE_MS) pending += TICK_SEC
      sinceSave += TICK_SEC
      if (sinceSave >= SAVE_EVERY_SEC && pending > 0) flush()
    }, TICK_SEC * 1000)
    return () => {
      clearInterval(timer)
      for (const e of events) window.removeEventListener(e, active, { capture: true })
      flush()
    }
  }, [lessonId])
}
