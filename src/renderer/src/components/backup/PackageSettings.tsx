import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, FileUp, Loader2, PackageOpen } from 'lucide-react'
import type { ExportCatalog, ExportSelection, PackageImportResult, PackagePreview } from '@shared/backup'
import { formatBytes, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { useToast } from '../Toast'

type Group = 'courseIds' | 'deckIds' | 'bankIds' | 'notebookIds' | 'mindmapIds'

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

function GroupList<T extends { id: number; title: string }>({ title, items, selected, onToggle, onAll, detail }: {
  title: string
  items: T[]
  selected: number[]
  onToggle: (id: number, on: boolean) => void
  onAll: (on: boolean) => void
  detail: (item: T) => string
}) {
  if (items.length === 0) return null
  const all = items.every((i) => selected.includes(i.id))
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</legend>
      <button type="button" onClick={() => onAll(!all)} className="mb-1 text-xs text-accent hover:underline">
        {all ? 'Desmarcar todos' : 'Marcar todos'}
      </button>
      {items.map((i) => (
        <Check key={i.id} checked={selected.includes(i.id)} onChange={(on) => onToggle(i.id, on)}>
          {i.title} <span className="text-xs text-muted">· {detail(i)}</span>
        </Check>
      ))}
    </fieldset>
  )
}

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const catalog = useQuery({ queryKey: ['package-catalog'], queryFn: () => window.api.packages.catalog(), enabled: open, staleTime: 0 })
  const [sel, setSel] = useState<ExportSelection>({ courseIds: [], deckIds: [], bankIds: [], notebookIds: [], mindmapIds: [], includeSchedule: true, includeProgress: true })
  const toggle = (group: Group, id: number, on: boolean) => setSel((s) => ({ ...s, [group]: on ? [...s[group], id] : s[group].filter((x) => x !== id) }))
  const all = (group: Group, items: { id: number }[], on: boolean) => setSel((s) => ({ ...s, [group]: on ? items.map((i) => i.id) : [] }))
  const count = sel.courseIds.length + sel.deckIds.length + sel.bankIds.length + sel.notebookIds.length + sel.mindmapIds.length

  const run = useMutation({
    mutationFn: () => window.api.packages.export(sel),
    onSuccess: (r) => {
      if (!r) return
      toast(`Pacote exportado (${formatBytes(r.bytes)})`)
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const c: ExportCatalog | undefined = catalog.data
  const empty = c && !c.courses.length && !c.decks.length && !c.banks.length && !c.notebooks.length && !c.mindmaps.length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exportar pacote de estudo"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => run.mutate()} disabled={count === 0 || run.isPending}>
            {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} Exportar {count ? `(${count})` : ''}
          </Button>
        </>
      }
    >
      {!c ? (
        <Loader2 className="mx-auto my-8 animate-spin text-muted" />
      ) : empty ? (
        <p className="text-sm text-muted">Ainda não há nada para exportar.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Um arquivo .tramotak para levar a outro computador ou compartilhar. Os vídeos não vão junto: quem importar liga os dados a um curso que já tenha a mesma pasta.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <GroupList
              title="Cursos (anotações e transcrições)"
              items={c.courses}
              selected={sel.courseIds}
              onToggle={(id, on) => toggle('courseIds', id, on)}
              onAll={(on) => all('courseIds', c.courses, on)}
              detail={(i) => `${plural(i.notes, 'anotação', 'anotações')}, ${plural(i.transcripts, 'transcrição', 'transcrições')}`}
            />
            <GroupList title="Baralhos" items={c.decks} selected={sel.deckIds} onToggle={(id, on) => toggle('deckIds', id, on)} onAll={(on) => all('deckIds', c.decks, on)} detail={(i) => plural(i.cards, 'carta')} />
            <GroupList
              title="Bancos de questões"
              items={c.banks}
              selected={sel.bankIds}
              onToggle={(id, on) => toggle('bankIds', id, on)}
              onAll={(on) => all('bankIds', c.banks, on)}
              detail={(i) => plural(i.questions, 'questão', 'questões')}
            />
            <GroupList title="Cadernos" items={c.notebooks} selected={sel.notebookIds} onToggle={(id, on) => toggle('notebookIds', id, on)} onAll={(on) => all('notebookIds', c.notebooks, on)} detail={(i) => plural(i.pages, 'página')} />
            <GroupList title="Mapas mentais" items={c.mindmaps} selected={sel.mindmapIds} onToggle={(id, on) => toggle('mindmapIds', id, on)} onAll={(on) => all('mindmapIds', c.mindmaps, on)} detail={(i) => plural(i.nodes, 'tópico')} />
          </div>
          <div className="border-t border-border pt-3">
            <Check checked={sel.includeProgress} onChange={(v) => setSel((s) => ({ ...s, includeProgress: v }))}>
              Incluir progresso das aulas <span className="text-xs text-muted">(onde parou, concluídas, favoritas)</span>
            </Check>
            <Check checked={sel.includeSchedule} onChange={(v) => setSel((s) => ({ ...s, includeSchedule: v }))}>
              Incluir agendamento dos flashcards <span className="text-xs text-muted">(desmarque para compartilhar: as cartas chegam como novas)</span>
            </Check>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ImportDialog({ preview, onClose }: { preview: PackagePreview | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list(), enabled: preview !== null, staleTime: 0 })
  const [map, setMap] = useState<Record<string, number | null>>({})
  const [done, setDone] = useState<PackageImportResult | null>(null)
  const choice = (key: string, suggested: number | null) => (key in map ? map[key] : suggested)

  const run = useMutation({
    mutationFn: () =>
      window.api.packages.import({ token: preview!.token, courseMap: Object.fromEntries(preview!.courses.map((c) => [c.key, choice(c.key, c.match)])) }),
    onSuccess: async (r) => {
      setDone(r)
      await queryClient.invalidateQueries()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const close = () => {
    setMap({})
    setDone(null)
    onClose()
  }

  if (!preview) return null
  const p = preview
  const parts = [
    p.decks.length && plural(p.decks.length, 'baralho'),
    p.banks.length && plural(p.banks.length, 'banco de questões', 'bancos de questões'),
    p.notebooks.length && plural(p.notebooks.length, 'caderno'),
    p.mindmaps.length && plural(p.mindmaps.length, 'mapa mental', 'mapas mentais')
  ].filter(Boolean)

  return (
    <Modal
      open
      onClose={close}
      title={done ? 'Pacote importado' : 'Importar pacote de estudo'}
      wide
      footer={
        done ? (
          <Button onClick={close}>Fechar</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Importar
            </Button>
          </>
        )
      }
    >
      {done ? (
        <ul className="space-y-1 text-sm">
          {done.decks > 0 && <li>{plural(done.decks, 'baralho')} com {plural(done.cards, 'carta')}</li>}
          {done.banks > 0 && <li>{plural(done.banks, 'banco', 'bancos')} com {plural(done.questions, 'questão', 'questões')}</li>}
          {done.notebooks > 0 && <li>{plural(done.notebooks, 'caderno')}</li>}
          {done.mindmaps > 0 && <li>{plural(done.mindmaps, 'mapa mental', 'mapas mentais')}</li>}
          {done.notes + done.progress + done.transcripts > 0 && (
            <li>
              Nos cursos: {plural(done.notes, 'anotação', 'anotações')}, {plural(done.transcripts, 'transcrição', 'transcrições')}, progresso de {plural(done.progress, 'aula')}
            </li>
          )}
          {done.unlinked > 0 && <li className="text-warning">{plural(done.unlinked, 'ligação com aula ficou de fora', 'ligações com aulas ficaram de fora')} (curso ou aula não encontrados)</li>}
        </ul>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Criado em {new Date(p.createdAt * 1000).toLocaleDateString('pt-BR')}
            {p.appVersion ? ` (Tramotak ${p.appVersion})` : ''}. Tudo entra como itens novos; nada do que você já tem é apagado.
          </p>
          {parts.length > 0 && <p>{parts.join(' · ')}</p>}
          {p.courses.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Ligar aos seus cursos</p>
              <ul className="space-y-2">
                {p.courses.map((c) => (
                  <li key={c.key} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                    <span>
                      {c.title}
                      <span className="block text-xs text-muted">
                        {c.withData ? `${plural(c.notes, 'anotação', 'anotações')} · ${plural(c.transcripts, 'transcrição', 'transcrições')} · progresso de ${plural(c.progress, 'aula')}` : 'só ligações de cartas, páginas ou mapas'}
                      </span>
                    </span>
                    <select
                      aria-label={`Curso local para ${c.title}`}
                      value={choice(c.key, c.match) ?? ''}
                      onChange={(e) => setMap((m) => ({ ...m, [c.key]: e.target.value ? Number(e.target.value) : null }))}
                      className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text"
                    >
                      <option value="">Não ligar (ignorar dados deste curso)</option>
                      {courses.data?.map((lc) => (
                        <option key={lc.id} value={lc.id}>
                          {lc.title}
                          {lc.id === c.match ? ' (sugerido)' : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">As aulas são casadas pelo caminho dentro da pasta do curso. Importe o curso antes, se ainda não tiver.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export function PackageSettings() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<PackagePreview | null>(null)
  const open = useMutation({
    mutationFn: () => window.api.packages.open(),
    onSuccess: (p) => p && setPreview(p),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" onClick={() => setExporting(true)}>
        <FileDown size={16} /> Exportar pacote…
      </Button>
      <Button variant="ghost" onClick={() => open.mutate()} disabled={open.isPending}>
        <PackageOpen size={16} /> Importar pacote…
      </Button>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      <ImportDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
