import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'

/** Configurações → Sobre: rever a introdução e pôr ou tirar o curso de exemplo. */
export function IntroSettings() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const onboarding = useQuery({ queryKey: queryKeys.onboarding, queryFn: () => window.api.onboarding.get(), staleTime: 0 })
  const refresh = () => {
    for (const key of [queryKeys.onboarding, queryKeys.courses, queryKeys.decks, queryKeys.dashboard]) void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ['banks'] })
  }
  const reopen = useMutation({ mutationFn: () => window.api.onboarding.reopen(), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'error') })
  const install = useMutation({
    mutationFn: () => window.api.onboarding.installSample(),
    onSuccess: () => {
      refresh()
      toast('Curso de exemplo adicionado em Meus Cursos')
    },
    onError: (e) => toast(errorMessage(e), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.onboarding.removeSample(),
    onSuccess: () => {
      setConfirming(false)
      refresh()
      toast('Curso de exemplo removido')
    },
    onError: (e) => toast(errorMessage(e), 'error')
  })
  const sample = onboarding.data?.sample

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
      <Button variant="ghost" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
        <RotateCcw size={16} /> Ver a introdução de novo
      </Button>
      {sample ? (
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          <Trash2 size={16} /> Remover o curso de exemplo
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => install.mutate()} disabled={install.isPending || onboarding.isPending}>
          {install.isPending ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />} Adicionar o curso de exemplo
        </Button>
      )}
      <ConfirmDialog open={confirming} title="Remover o curso de exemplo" confirmLabel="Remover" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirming(false)}>
        <p className="text-sm">
          Apaga o curso “Como usar o Tramotak”, o baralho e o banco de questões de exemplo, com o progresso e as anotações feitas neles. Os seus cursos não são afetados.
        </p>
      </ConfirmDialog>
    </div>
  )
}
