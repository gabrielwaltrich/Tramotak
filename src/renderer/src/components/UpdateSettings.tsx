import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { errorMessage, queryKeys } from '../lib/api'
import { useUpdates } from '../lib/useUpdates'
import { Button } from './Button'
import { useToast } from './Toast'

const MODE_NOTE = {
  auto: 'As versões novas são baixadas em segundo plano e instaladas quando você reinicia o app.',
  notify: 'Nesta instalação o Tramotak não consegue se trocar sozinho (macOS sem assinatura ou versão portátil): ele avisa e leva à página da versão nova.',
  dev: 'Rodando a partir do código-fonte: sem atualizações automáticas.'
}

export function UpdateSettings() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const info = useUpdates()
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get() })
  const toggle = useMutation({
    mutationFn: (value: boolean) => window.api.settings.update({ autoUpdateCheck: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  })
  const check = useMutation({ mutationFn: () => window.api.updates.check(), onError: (e) => toast(errorMessage(e), 'error') })
  if (!info) return null
  const s = info.state

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Versão <b>{info.current}</b>
        </span>
        {s.status === 'checking' && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Loader2 size={14} className="animate-spin" /> Procurando…
          </span>
        )}
        {s.status === 'none' && (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 size={14} /> Você está na versão mais recente
          </span>
        )}
        {s.status === 'downloading' && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Download size={14} /> Baixando a versão {s.version}… {s.percent}%
          </span>
        )}
        {s.status === 'error' && <span className="text-warning">{s.message}</span>}
        {info.mode !== 'dev' && s.status !== 'downloading' && s.status !== 'ready' && (
          <Button variant="ghost" className="ml-auto h-8" onClick={() => check.mutate()} disabled={s.status === 'checking'}>
            <RefreshCw size={14} /> Procurar agora
          </Button>
        )}
      </div>
      {s.status === 'ready' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <span>
            A versão <b>{s.version}</b> está pronta.{info.needsPassword ? ' O sistema vai pedir a sua senha para instalar.' : ''}
          </span>
          <Button className="ml-auto h-8" onClick={() => window.api.updates.install()}>
            <RotateCw size={14} /> Reiniciar e atualizar
          </Button>
        </div>
      )}
      {s.status === 'available' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <span>
            A versão <b>{s.version}</b> está disponível.
          </span>
          <Button className="ml-auto h-8" onClick={() => window.api.updates.openRelease()}>
            <ExternalLink size={14} /> Baixar
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">{MODE_NOTE[info.mode]}</p>
      {info.mode !== 'dev' && settings.data && (
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={settings.data.autoUpdateCheck} onChange={(e) => toggle.mutate(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Procurar atualizações sozinho (ao abrir e a cada 6 horas; consulta as Releases do GitHub)
        </label>
      )}
    </div>
  )
}

/** Aviso discreto na barra superior quando há versão nova. */
export function UpdateBadge() {
  const info = useUpdates()
  const s = info?.state
  if (s?.status === 'ready') {
    return (
      <button type="button" onClick={() => window.api.updates.install()} className="ml-3 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-on-accent hover:brightness-110">
        <RotateCw size={13} /> Atualizar para {s.version}
      </button>
    )
  }
  if (s?.status === 'available') {
    return (
      <button type="button" onClick={() => window.api.updates.openRelease()} className="ml-3 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-accent/50 px-3 text-xs text-accent hover:bg-accent-soft">
        <Download size={13} /> Versão {s.version} disponível
      </button>
    )
  }
  return null
}
