import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { errorMessage } from '../../lib/api'
import { useMediaJobs } from '../../lib/useMediaJobs'
import { useToast } from '../Toast'

/** Dentro do aviso de vídeo incompatível: explica o motivo e oferece converter (ou abrir no sistema). */
export function ConvertOffer({ lessonId }: { lessonId: number }) {
  const toast = useToast()
  const info = useQuery({ queryKey: ['probe', lessonId], queryFn: () => window.api.media.probe(lessonId), retry: false, staleTime: 0 })
  const job = useMediaJobs().find((j) => j.kind === 'convert' && j.lessonId === lessonId && j.status !== 'canceled')
  const running = job && (job.status === 'running' || job.status === 'queued')
  const canConvert = info.data && !info.data.playable && info.data.plan !== 'none'
  const quick = info.data?.plan === 'remux' || info.data?.plan === 'audio'

  const convert = () => window.api.media.enqueue('convert', lessonId).catch((e) => toast(errorMessage(e), 'error'))

  return (
    <>
      <p className="max-w-sm text-sm text-white/70">
        {info.isPending ? 'Verificando o formato…' : info.isError ? errorMessage(info.error) : `${info.data.reason}.`}
        {canConvert && !running && ` O Tramotak pode criar uma cópia compatível${quick ? ' (rápido, sem perder qualidade)' : ''}; o arquivo original não é alterado.`}
      </p>
      {running ? (
        <div className="w-64 space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <p className="flex items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 size={14} className="animate-spin" /> {job.status === 'queued' ? 'Na fila…' : `Convertendo… ${Math.round(job.progress * 100)}%`}
            <button type="button" onClick={() => window.api.media.cancel(job.id)} aria-label="Cancelar conversão" className="text-white/60 hover:text-white">
              <X size={14} />
            </button>
          </p>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {canConvert && (
            <button type="button" onClick={convert} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm hover:brightness-110">
              <RefreshCw size={16} /> Converter para tocar aqui
            </button>
          )}
          <button type="button" onClick={() => window.api.files.openLesson(lessonId)} className="inline-flex items-center gap-2 rounded-md bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
            <ExternalLink size={16} /> Abrir no player do sistema
          </button>
        </div>
      )}
      {job?.status === 'error' && <p className="max-w-sm text-xs text-red-300">{job.error}</p>}
    </>
  )
}
