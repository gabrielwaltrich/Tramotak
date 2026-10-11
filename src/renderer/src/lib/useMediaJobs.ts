import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { MediaJob } from '@shared/media'

/**
 * Fila de conversões/transcrições, ao vivo. Quando uma tarefa termina, recarrega os dados
 * da aula afetada (novo endereço do vídeo, nova transcrição).
 */
export function useMediaJobs(): MediaJob[] {
  const [jobs, setJobs] = useState<MediaJob[]>([])
  const queryClient = useQueryClient()
  const seen = useRef(new Map<number, MediaJob['status']>())

  useEffect(() => {
    const apply = (list: MediaJob[]) => {
      for (const job of list) {
        const before = seen.current.get(job.id)
        if (job.status === 'done' && before !== 'done') {
          void queryClient.invalidateQueries({ queryKey: ['lessons', job.lessonId] })
          void queryClient.invalidateQueries({ queryKey: ['transcript', job.lessonId] })
          void queryClient.invalidateQueries({ queryKey: ['search'] })
        }
        seen.current.set(job.id, job.status)
      }
      setJobs(list)
    }
    void window.api.media.jobs().then(apply)
    return window.api.media.onJobs(apply)
  }, [queryClient])

  return jobs
}
