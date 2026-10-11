import { useEffect, useRef, type RefObject } from 'react'

const SAVE_EVERY_MS = 5000

/**
 * Envia posição, duração e tempo assistido a cada 5 s tocando, ao pausar,
 * ao trocar de aula e ao fechar a janela.
 */
export function useProgressTracker(videoRef: RefObject<HTMLVideoElement | null>, lessonId: number) {
  const watched = useRef(0)
  const lastTime = useRef<number | null>(null)
  const lastSave = useRef(0)

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
      window.api.progress
        .save({
          lessonId,
          positionSec: video.currentTime,
          durationSec: Number.isFinite(video.duration) ? video.duration : null,
          watchedSec
        })
        .catch(() => {})
    }

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
  }, [videoRef, lessonId])
}
