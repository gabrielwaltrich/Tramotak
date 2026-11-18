import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileDown, Loader2 } from 'lucide-react'
import type { DeckExportFormat } from '@shared/flashcards'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { useToast } from '../Toast'

const FORMATS: { value: DeckExportFormat; label: string; hint: string }[] = [
  { value: 'apkg', label: 'Pacote do Anki (.apkg)', hint: 'Abre com dois cliques no Anki, AnkiDroid e AnkiMobile. Cada baralho vira um baralho do Anki.' },
  { value: 'text', label: 'Texto (.txt)', hint: 'Frente, verso, fonte e baralho separados por tabulação: para o Anki (Arquivo → Importar) e planilhas.' }
]

/**
 * Exportar baralhos para o Anki. Cada carta vai com um campo Fonte (curso, módulo, aula e minuto); no .apkg, dá para
 * levar também o agendamento e o histórico, para continuar as revisões de onde parou (no celular, por exemplo).
 */
export function ExportDecksDialog({ initial, onClose }: { initial: number[]; onClose: () => void }) {
  const toast = useToast()
  const decks = useQuery({ queryKey: queryKeys.decks, queryFn: () => window.api.decks.list() })
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(initial))
  const [format, setFormat] = useState<DeckExportFormat>('apkg')
  const [schedule, setSchedule] = useState(true)
  const list = decks.data ?? []
  const cards = list.filter((d) => chosen.has(d.id)).reduce((n, d) => n + d.total, 0)

  const run = useMutation({
    mutationFn: () => window.api.decks.exportFile({ deckIds: [...chosen], format, includeSchedule: schedule }),
    onSuccess: (result) => {
      if (!result) return
      toast(`${plural(result.cards, 'carta exportada', 'cartas exportadas')} de ${plural(result.decks, 'baralho')}`)
      onClose()
    },
    onError: (e) => toast(errorMessage(e), 'error')
  })
  const toggle = (id: number) =>
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Exportar para o Anki"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => run.mutate()} disabled={cards === 0 || run.isPending} data-autofocus>
            {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} Exportar ({plural(cards, 'carta')})
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <fieldset>
          <legend className="mb-2 font-medium">Baralhos</legend>
          <div className="mb-2 flex gap-3 text-xs">
            <button type="button" className="text-accent hover:underline" onClick={() => setChosen(new Set(list.map((d) => d.id)))}>
              Marcar todos
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => setChosen(new Set())}>
              Desmarcar
            </button>
          </div>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {list.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={chosen.has(d.id)} onChange={() => toggle(d.id)} className="size-4 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="text-xs text-muted">{plural(d.total, 'carta')}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">Formato</legend>
          <div className="space-y-2">
            {FORMATS.map((f) => (
              <label key={f.value} className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="formato" checked={format === f.value} onChange={() => setFormat(f.value)} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  <span className="block">{f.label}</span>
                  <span className="block text-xs text-muted">{f.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={`flex items-start gap-3 ${format === 'apkg' ? 'cursor-pointer' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={format === 'apkg' && schedule}
            disabled={format !== 'apkg'}
            onChange={(e) => setSchedule(e.target.checked)}
            className="mt-1 size-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block">Levar o agendamento e o histórico</span>
            <span className="block text-xs text-muted">
              As revisões continuam de onde pararam (o FSRS do Anki recalcula pelo histórico). Desmarcado, as cartas entram como novas.
            </span>
          </span>
        </label>
        <p className="text-xs text-muted">Cada carta leva um campo Fonte com o curso, a aula e o minuto, mostrado embaixo do verso no Anki.</p>
      </div>
    </Modal>
  )
}
