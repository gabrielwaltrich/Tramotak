import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bug, Copy, ExternalLink, Loader2, Save } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { Button } from './Button'
import { Modal } from './Modal'
import { useToast } from './Toast'

/**
 * Configurações → Sobre → "Relatar problema": mostra o diagnóstico inteiro antes (a pessoa vê o que vai), sem dados
 * pessoais, para copiar, salvar ou colar no formulário de problema do GitHub. Nada é enviado sozinho.
 */
export function ReportProblem() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Bug size={16} /> Relatar problema
      </Button>
      {open && <ReportDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function ReportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const text = useQuery({ queryKey: ['diagnostics'], queryFn: () => window.api.diagnostics.get(), staleTime: 0, gcTime: 0 })
  const copy = useMutation({
    mutationFn: () => window.api.diagnostics.copy(),
    onSuccess: () => toast('Diagnóstico copiado'),
    onError: (e) => toast(errorMessage(e), 'error')
  })
  const save = useMutation({
    mutationFn: () => window.api.diagnostics.save(),
    onSuccess: (path) => path && toast('Diagnóstico salvo'),
    onError: (e) => toast(errorMessage(e), 'error')
  })
  const issue = useMutation({ mutationFn: () => window.api.diagnostics.openIssue(), onError: (e) => toast(errorMessage(e), 'error') })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Relatar problema"
      footer={
        <>
          <Button variant="ghost" onClick={() => save.mutate()} disabled={!text.data || save.isPending}>
            <Save size={16} /> Salvar arquivo…
          </Button>
          <Button variant="ghost" onClick={() => copy.mutate()} disabled={!text.data || copy.isPending}>
            <Copy size={16} /> Copiar
          </Button>
          <Button onClick={() => issue.mutate()} disabled={issue.isPending} data-autofocus>
            <ExternalLink size={16} /> Abrir formulário no GitHub
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Copie o diagnóstico abaixo e cole no campo <b>Diagnóstico</b> do formulário de problema, junto com o que aconteceu e os passos para repetir. Ele tem a versão, o
          sistema, contagens, as opções principais e os erros recentes.
        </p>
        <p className="text-xs text-muted">
          Nada é enviado sozinho. Caminhos aparecem como &lt;pasta pessoal&gt; e &lt;curso 1&gt;; títulos, anotações, chaves de API e endereços de servidores ficam de
          fora. Confira o texto antes de mandar.
        </p>
        {text.isPending ? (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin" /> Montando o diagnóstico…
          </p>
        ) : text.isError ? (
          <p className="text-red-400">{errorMessage(text.error)}</p>
        ) : (
          <pre aria-label="Diagnóstico" tabIndex={0} className="max-h-80 overflow-auto rounded-lg border border-border bg-bg/60 p-3 font-mono text-xs whitespace-pre-wrap">
            {text.data}
          </pre>
        )}
      </div>
    </Modal>
  )
}
