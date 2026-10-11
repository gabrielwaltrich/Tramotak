import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mic, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { formatClock } from '@shared/format'
import { matches } from '@shared/search'
import { errorMessage } from '../../lib/api'
import { useMediaJobs } from '../../lib/useMediaJobs'
import { Button } from '../Button'
import { TextInput } from '../Field'
import { useToast } from '../Toast'

/** Transcrição da aula: gerar, buscar no texto falado e pular para o trecho. */
export function TranscriptPanel({ lessonId, getTime, onSeek }: { lessonId: number; getTime: () => number | null; onSeek: (sec: number) => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [now, setNow] = useState(0)
  const transcript = useQuery({ queryKey: ['transcript', lessonId], queryFn: () => window.api.transcripts.get(lessonId), staleTime: 0 })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() })
  const job = useMediaJobs().find((j) => j.kind === 'transcribe' && j.lessonId === lessonId && (j.status === 'running' || j.status === 'queued'))

  // Acompanha o vídeo para destacar o trecho que está sendo falado.
  useEffect(() => {
    const timer = setInterval(() => setNow(getTime() ?? 0), 500)
    return () => clearInterval(timer)
  }, [getTime])

  const start = useMutation({
    mutationFn: () => window.api.media.enqueue('transcribe', lessonId),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.transcripts.delete(lessonId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transcript', lessonId] })
      void queryClient.invalidateQueries({ queryKey: ['lessons', lessonId] })
    }
  })

  const segments = useMemo(() => (transcript.data?.segments ?? []).filter((s) => matches(filter, s.text)), [transcript.data, filter])

  if (job) {
    return (
      <div className="space-y-2 py-4 text-center text-sm">
        <p className="inline-flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin" /> {job.status === 'queued' ? 'Na fila para transcrever…' : `Transcrevendo… ${Math.round(job.progress * 100)}%`}
        </p>
        <div className="mx-auto h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
        <button type="button" onClick={() => window.api.media.cancel(job.id)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-red-400">
          <X size={12} /> Cancelar
        </button>
      </div>
    )
  }

  if (transcript.isPending) return <Loader2 className="mx-auto my-6 animate-spin text-muted" />

  if (!transcript.data) {
    const configured = settings.data && settings.data.transcriptionProvider !== 'none'
    return (
      <div className="space-y-3 py-6 text-center text-sm">
        <p className="text-muted">Esta aula ainda não tem transcrição.</p>
        {configured ? (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            <Mic size={16} /> Transcrever esta aula
          </Button>
        ) : (
          <p className="text-xs text-muted">
            Para transcrever, escolha um provedor (Groq ou um Whisper local) em{' '}
            <Link to="/settings" className="text-accent hover:underline">
              Configurações
            </Link>
            .
          </p>
        )}
      </div>
    )
  }

  const t = transcript.data
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar no que foi dito…" className="h-8 pl-8" aria-label="Buscar na transcrição" />
        </div>
        <button type="button" onClick={() => start.mutate()} title="Transcrever de novo" aria-label="Transcrever de novo" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
          <RotateCcw size={14} />
        </button>
        <button type="button" onClick={() => remove.mutate()} title="Excluir transcrição" aria-label="Excluir transcrição" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-red-400">
          <Trash2 size={14} />
        </button>
      </div>
      <ol className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
        {segments.map((s, i) => {
          const current = now >= s.start && now < s.end
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm ${current ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
              >
                <span className="shrink-0 pt-px text-xs text-accent tabular-nums">{formatClock(s.start)}</span>
                <span className="select-text">{s.text}</span>
              </button>
            </li>
          )
        })}
        {segments.length === 0 && <li className="py-4 text-center text-sm text-muted">Nada encontrado.</li>}
      </ol>
      <p className="mt-2 text-[11px] text-muted">
        Transcrito por {t.provider === 'groq' ? 'Groq' : 'Whisper local'} ({t.model}) em {new Date(t.createdAt * 1000).toLocaleDateString('pt-BR')}. Também aparece como legenda no player.
      </p>
    </div>
  )
}
