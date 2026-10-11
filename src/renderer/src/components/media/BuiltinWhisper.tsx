import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Loader2, Trash2, X } from 'lucide-react'
import type { AppSettings } from '@shared/ipc'
import { WHISPER_MODELS, type WhisperModelId } from '@shared/media'
import { formatBytes } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { useToast } from '../Toast'

/** Transcrição embutida (whisper.cpp): baixar, escolher e apagar modelos. */
export function BuiltinWhisper({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['whisper-status'], queryFn: () => window.api.media.whisperStatus(), staleTime: 0 })
  const [progress, setProgress] = useState<{ model: WhisperModelId; fraction: number } | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['whisper-status'] })

  useEffect(
    () =>
      window.api.media.onWhisperProgress((p) => {
        setProgress(p.done ? null : { model: p.model, fraction: p.fraction })
        if (p.done) void queryClient.invalidateQueries({ queryKey: ['whisper-status'] })
      }),
    [queryClient]
  )

  const choose = useMutation({
    mutationFn: (model: WhisperModelId) => window.api.settings.update({ builtinWhisperModel: model }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  })
  const download = useMutation({
    mutationFn: (model: WhisperModelId) => window.api.media.whisperDownload(model),
    onSuccess: (_r, model) => {
      void refresh()
      choose.mutate(model)
      toast('Modelo baixado e escolhido')
    },
    onError: (error) => errorMessage(error) !== 'Cancelado' && toast(errorMessage(error), 'error')
  })
  const remove = useMutation({ mutationFn: (model: WhisperModelId) => window.api.media.whisperDelete(model), onSuccess: refresh })

  if (status.isPending) return <Loader2 className="animate-spin text-muted" size={16} />
  if (!status.data?.available) {
    return <p className="text-xs text-warning">Esta instalação não trouxe o programa de transcrição embutida. Atualize o Tramotak ou use outra opção.</p>
  }
  const installed = new Set(status.data.installed)

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Transcreve no seu computador, grátis e sem internet (o áudio não sai da máquina). Baixe um modelo uma vez; quanto maior, mais preciso e mais lento.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {WHISPER_MODELS.map((m) => {
          const here = installed.has(m.id)
          const active = settings.builtinWhisperModel === m.id
          const running = progress?.model === m.id || (download.isPending && download.variables === m.id)
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  {m.label} <span className="text-xs text-muted">· {formatBytes(m.bytes)}</span>
                  {m.id === 'small-q5_1' && <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">recomendado</span>}
                </p>
                <p className="text-xs text-muted">{m.note}</p>
                {running && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-surface-2">
                      <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right text-[11px] text-muted tabular-nums">{Math.round((progress?.fraction ?? 0) * 100)}%</span>
                  </div>
                )}
              </div>
              {running ? (
                <Button variant="ghost" className="h-8" onClick={() => window.api.media.whisperCancelDownload()}>
                  <X size={14} /> Cancelar
                </Button>
              ) : here ? (
                <div className="flex items-center gap-2">
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 size={14} /> Em uso
                    </span>
                  ) : (
                    <Button variant="ghost" className="h-8" onClick={() => choose.mutate(m.id)}>
                      Usar
                    </Button>
                  )}
                  <button type="button" onClick={() => remove.mutate(m.id)} className="text-muted hover:text-red-400" aria-label={`Apagar modelo ${m.label}`} title="Apagar o arquivo do modelo">
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <Button variant="ghost" className="h-8" disabled={download.isPending} onClick={() => download.mutate(m.id)}>
                  <Download size={14} /> Baixar
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {!installed.has(settings.builtinWhisperModel) && !progress && <p className="text-xs text-warning">Baixe um modelo para começar a transcrever.</p>}
    </div>
  )
}
