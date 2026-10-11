import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { plural } from '@shared/format'
import { errorMessage } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { useToast } from '../Toast'

/** Verifica todos os vídeos do curso e converte em lote os que o player não toca. */
export function FormatCheckDialog({ courseId, open, onClose }: { courseId: number; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Formatos dos vídeos" wide>
      {open && <Body courseId={courseId} onClose={onClose} />}
    </Modal>
  )
}

function Body({ courseId, onClose }: { courseId: number; onClose: () => void }) {
  const toast = useToast()
  const check = useQuery({ queryKey: ['format-check', courseId], queryFn: () => window.api.media.checkCourse(courseId), staleTime: 0, gcTime: 0 })
  const convertAll = useMutation({
    mutationFn: async () => {
      const list = (check.data?.incompatible ?? []).filter((i) => i.plan !== 'none')
      for (const item of list) await window.api.media.enqueue('convert', item.lessonId)
      return list.length
    },
    onSuccess: (n) => {
      toast(`${plural(n, 'vídeo')} na fila de conversão`)
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  if (check.isPending) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Verificando cada vídeo do curso…
      </p>
    )
  }
  if (check.isError) return <p className="text-sm text-red-400">{errorMessage(check.error)}</p>
  const { checked, incompatible } = check.data
  const convertible = incompatible.filter((i) => i.plan !== 'none')

  if (incompatible.length === 0) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm">
        <CheckCircle2 size={18} className="text-success" /> Todos os {plural(checked, 'vídeo')} tocam no player.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {plural(incompatible.length, 'vídeo', 'vídeos')} de {checked} não {incompatible.length === 1 ? 'toca' : 'tocam'} no player. A conversão cria cópias na pasta do
        app; os arquivos do curso não são alterados.
      </p>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {incompatible.map((i) => (
          <li key={i.lessonId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="shrink-0 text-xs text-muted">{i.reason}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${i.plan === 'full' ? 'bg-warning/10 text-warning' : i.plan === 'none' ? 'bg-red-500/10 text-red-400' : 'bg-success/10 text-success'}`}>
              {i.plan === 'full' ? 'recodificar' : i.plan === 'none' ? 'ilegível' : 'rápido'}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button onClick={() => convertAll.mutate()} disabled={convertible.length === 0 || convertAll.isPending}>
          Converter {plural(convertible.length, 'vídeo')}
        </Button>
      </div>
    </div>
  )
}
