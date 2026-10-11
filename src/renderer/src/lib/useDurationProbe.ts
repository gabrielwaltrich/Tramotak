import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CourseDetail } from '@shared/course'
import { mediaUrl } from '@shared/media'
import { queryKeys } from './api'

const TIMEOUT_MS = 10_000

/** Lê só os metadados (duração) de um vídeo, sem baixá-lo inteiro nem tocar. */
function probe(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const done = (value: number | null) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = setTimeout(() => done(null), TIMEOUT_MS)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

function missingDurations(course: CourseDetail): number[] {
  const ids: number[] = []
  const visit = (lessons: CourseDetail['lessons']) => {
    for (const l of lessons) if (l.kind === 'video' && l.durationSec === null) ids.push(l.id)
  }
  const walk = (mods: CourseDetail['modules']) => mods.forEach((m) => (visit(m.lessons), walk(m.children)))
  visit(course.lessons)
  walk(course.modules)
  return ids
}

/** Preenche em segundo plano a duração das aulas de vídeo que ainda não têm. */
export function useDurationProbe(course: CourseDetail | undefined) {
  const queryClient = useQueryClient()
  const courseId = course?.id
  const pending = course ? missingDurations(course).join(',') : ''

  useEffect(() => {
    if (!pending || courseId === undefined) return
    let cancelled = false
    ;(async () => {
      let found = 0
      for (const id of pending.split(',').map(Number)) {
        if (cancelled) return
        const duration = await probe(mediaUrl.lesson(id))
        if (duration && !cancelled) {
          await window.api.lessons.setDuration(id, duration).catch(() => {})
          found++
        }
      }
      // Vídeos ilegíveis ficam sem duração; só recarrega se algo novo foi lido.
      if (!cancelled && found > 0) queryClient.invalidateQueries({ queryKey: queryKeys.courses })
    })()
    return () => {
      cancelled = true
    }
  }, [pending, courseId, queryClient])
}
