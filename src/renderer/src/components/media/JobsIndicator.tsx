import { useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, CheckCircle2, Film, Loader2, Mic, X } from 'lucide-react'
import type { MediaJob } from '@shared/media'
import { useMediaJobs } from '../../lib/useMediaJobs'

const LABEL: Record<MediaJob['kind'], string> = { convert: 'Convertendo', transcribe: 'Transcrevendo' }

function Row({ job }: { job: MediaJob }) {
  const Icon = job.kind === 'convert' ? Film : Mic
  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center gap-2 text-xs">
        {job.status === 'running' || job.status === 'queued' ? (
          <Icon size={13} className="shrink-0 text-accent" />
        ) : job.status === 'done' ? (
          <CheckCircle2 size={13} className="shrink-0 text-success" />
        ) : (
          <AlertCircle size={13} className={`shrink-0 ${job.status === 'error' ? 'text-red-400' : 'text-muted'}`} />
        )}
        <Link to={`/lesson/${job.lessonId}`} className="min-w-0 flex-1 truncate hover:text-accent" title={job.lessonTitle}>
          {job.lessonTitle}
        </Link>
        {(job.status === 'running' || job.status === 'queued') && (
          <button type="button" onClick={() => window.api.media.cancel(job.id)} aria-label={`Cancelar ${job.lessonTitle}`} className="text-muted hover:text-red-400">
            <X size={13} />
          </button>
        )}
      </div>
      {job.status === 'running' && (
        <div className="h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
      {job.status === 'queued' && <p className="text-[11px] text-muted">Na fila</p>}
      {job.status === 'error' && <p className="text-[11px] text-red-400">{job.error}</p>}
      {job.status === 'canceled' && <p className="text-[11px] text-muted">Cancelada</p>}
    </li>
  )
}

/** Indicador da fila na barra lateral (só aparece quando há tarefas). */
export function JobsIndicator({ collapsed }: { collapsed: boolean }) {
  const jobs = useMediaJobs()
  const [open, setOpen] = useState(false)
  if (jobs.length === 0) return null
  const active = jobs.find((j) => j.status === 'running') ?? jobs.find((j) => j.status === 'queued')
  const pending = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  const failed = jobs.some((j) => j.status === 'error')
  const failedCount = jobs.filter((j) => j.status === 'error').length
  const doneCount = jobs.filter((j) => j.status === 'done').length
  // Com centenas de tarefas, mostra a atual, as próximas e as últimas terminadas.
  const running = jobs.filter((j) => j.status === 'running')
  const queued = jobs.filter((j) => j.status === 'queued')
  const finished = jobs.filter((j) => j.status !== 'running' && j.status !== 'queued').reverse()
  const visible = [...running, ...queued.slice(0, 10), ...finished.slice(0, 20)]
  const hidden = Math.max(0, queued.length - 10)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Fila de processamento"
        className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-text"
      >
        {active ? <Loader2 size={18} className="shrink-0 animate-spin text-accent" /> : failed ? <AlertCircle size={18} className="shrink-0 text-red-400" /> : <CheckCircle2 size={18} className="shrink-0 text-success" />}
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-left">
            {active ? `${LABEL[active.kind]} ${Math.round(active.progress * 100)}%${pending > 1 ? ` · +${pending - 1}` : ''}` : failed ? 'Tarefa com erro' : 'Tarefas concluídas'}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-11 left-2 z-30 w-72 rounded-lg border border-border bg-surface-2 p-3 shadow-xl">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium tracking-wider text-muted uppercase">Processamento</p>
            <div className="flex gap-2 text-xs text-muted">
              {failedCount > 0 && (
                <button type="button" onClick={() => window.api.media.retryFailed()} className="hover:text-text">
                  Repetir com erro
                </button>
              )}
              {pending > 1 && (
                <button type="button" onClick={() => window.api.media.cancelAll()} className="hover:text-red-400">
                  Cancelar fila
                </button>
              )}
              <button type="button" onClick={() => window.api.media.clearFinished()} className="hover:text-text">
                Limpar
              </button>
            </div>
          </div>
          {jobs.length > 8 && (
            <p className="pb-1 text-[11px] text-muted">
              {doneCount} concluídas · {pending} na fila{failedCount ? ` · ${failedCount} com erro` : ''}
            </p>
          )}
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {visible.map((j) => (
              <Row key={j.id} job={j} />
            ))}
          </ul>
          {hidden > 0 && <p className="pt-2 text-center text-[11px] text-muted">+{hidden} na fila</p>}
        </div>
      )}
    </div>
  )
}
