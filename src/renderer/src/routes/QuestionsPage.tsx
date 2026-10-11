import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, FileUp, Loader2, Plus } from 'lucide-react'
import { plural } from '@shared/format'
import { errorMessage } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { BankDialog } from '../components/questions/BankDialog'
import { useToast } from '../components/Toast'

export function QuestionsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => window.api.banks.list(), staleTime: 0 })

  const importFile = useMutation({
    mutationFn: () => window.api.banks.importFile(null),
    onSuccess: async (result) => {
      if (!result) return
      await queryClient.invalidateQueries({ queryKey: ['banks'] })
      toast(`“${result.bankTitle}”: ${plural(result.imported, 'questão importada', 'questões importadas')}${result.skipped ? ` (${result.skipped} não suportadas)` : ''}`)
      navigate(`/questions/${result.bankId}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const list = banks.data ?? []

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Questões"
        subtitle="Bancos de questões e simulados cronometrados"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => importFile.mutate()} disabled={importFile.isPending}>
              {importFile.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Importar
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo banco
            </Button>
          </div>
        }
      />
      {banks.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="Nenhum banco de questões"
          description="Crie um banco e escreva suas questões, ou importe de JSON, CSV ou GIFT (Moodle)."
          action={<Button onClick={() => setCreating(true)}>Criar banco</Button>}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => navigate(`/questions/${b.id}`)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-2/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.title}</p>
                  <p className="truncate text-xs text-muted">
                    {plural(b.questionCount, 'questão', 'questões')} · {plural(b.examCount, 'simulado')} · {plural(b.attemptCount, 'tentativa')}
                  </p>
                </div>
                {b.lastPercent !== null && (
                  <span className="text-right text-sm">
                    <span className="block font-semibold tabular-nums">{b.lastPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
                    <span className="text-xs text-muted">última nota</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <BankDialog open={creating} bank={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/questions/${id}`)} />
    </div>
  )
}
