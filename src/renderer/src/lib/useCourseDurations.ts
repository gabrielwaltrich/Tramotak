import { useEffect, useState } from 'react'

/**
 * Pede ao processo principal as durações que faltam no curso e acompanha o progresso.
 * Devolve quantos vídeos ainda estão sem duração enquanto a medição roda (`null` quando parada).
 */
export function useCourseDurations(courseId: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    const off = window.api.courses.onDurations((u) => {
      if (u.courseId === courseId) setRemaining(u.done ? null : u.remaining)
    })
    void window.api.courses.fillDurations(courseId)
    return off
  }, [courseId])
  return remaining
}
