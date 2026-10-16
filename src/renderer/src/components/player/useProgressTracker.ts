import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { ProgressUpdate } from '@shared/course'

const SAVE_EVERY_MS = 5000

const saveToDb = (update: ProgressUpdate) => void window.api.progress.save(update).catch(() => {})

/**
 * Envia posição, duração e tempo assistido a cada 5 s tocando, ao pausar,
 * ao trocar de aula e ao fechar a janela. Devolve uma função que envia na hora (ex.: antes de fechar a janela
 * flutuante, que não espera o `beforeunload`).
 *
 * `send` troca o destino (a janela flutuante manda ao processo principal); `resetKey` religa quando o elemento de
 * vídeo é recriado sem trocar de aula.
 */
export function useProgressTracker(
  videoRef: RefObject<HTMLVideoElement | null>,
  lessonId: number,
  send: (update: ProgressUpdate) => void = saveToDb,
  resetKey?: unknown
): () => void {
  const watched = useRef(0)
  const lastTime = useRef<number | null>(null)
  const lastSave = useRef(0)
  const flush = useRef<() => void>(() => {})
  const sendRef = useRef(send)

  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    watched.current = 0
    lastTime.current = null
    lastSave.current = Date.now()

    const save = () => {
      if (!Number.isFinite(video.duration) && video.currentTime === 0) return
      const watchedSec = watched.current
      watched.current = 0
      lastSave.current = Date.now()
      sendRef.current({
        lessonId,
        positionSec: video.currentTime,
        durationSec: Number.isFinite(video.duration) ? video.duration : null,
        watchedSec
      })
    }
    flush.current = save

    const onTime = () => {
      const now = video.currentTime
      // Conta tempo real de estudo: avanço normal da reprodução, dividido pela velocidade.
      if (!video.paused && !video.seeking && lastTime.current !== null) {
        const delta = now - lastTime.current
        if (delta > 0 && delta < 2) watched.current += delta / video.playbackRate
      }
      lastTime.current = now
      if (Date.now() - lastSave.current >= SAVE_EVERY_MS && !video.paused) save()
    }
    const onSeeked = () => (lastTime.current = video.currentTime)
    const onHide = () => document.visibilityState === 'hidden' && save()

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('pause', save)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', save)
    return () => {
      save()
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('pause', save)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', save)
    }
  }, [videoRef, lessonId, resetKey])

  return useCallback(() => flush.current(), [])
}
