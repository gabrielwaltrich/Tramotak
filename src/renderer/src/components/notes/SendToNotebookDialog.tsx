import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, NotebookPen } from 'lucide-react'
import { plural } from '@shared/format'
import { suggestedPageTitle, type NoteEntry, type SendNotesResult } from '@shared/notes'
import { errorMessage } from '../../lib/api'
import { readPref, writePref } from '../../storage'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextInput } from '../Field'
import { useToast } from '../Toast'

const LAST_NOTEBOOK = 'tramotak.notes.lastNotebook'
const NEW = 'new'

/** Leva anotações para um caderno: novo ou existente, numa página nova ou no fim de uma página. */
export function SendToNotebookDialog({ entries, onClose }: { entries: NoteEntry[]; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: () => window.api.notebooks.list(), staleTime: 0 })
  const suggested = suggestedPageTitle(entries)
  const [notebook, setNotebook] = useState<string>(() => readPref(LAST_NOTEBOOK) ?? NEW)
  const [notebookTitle, setNotebookTitle] = useState(() => (entries.length && new Set(entries.map((e) => e.courseId)).size === 1 ? entries[0].courseTitle : 'Anotações'))
  const [page, setPage] = useState<string>(NEW)
  const [pageTitle, setPageTitle] = useState(suggested)
  const [done, setDone] = useState<SendNotesResult | null>(null)

  // O caderno lembrado pode ter sido apagado.
  const notebookId = notebook !== NEW && notebooks.data?.some((n) => n.id === Number(notebook)) ? Number(notebook) : null
  const detail = useQuery({
    queryKey: ['notebook', notebookId],
    queryFn: () => window.api.notebooks.get(notebookId!),
    enabled: notebookId !== null
  })
  const pageId = notebookId !== null && page !== NEW && detail.data?.pages.some((p) => p.id === Number(page)) ? Number(page) : null
  const lessons = new Set(entries.map((e) => e.lessonId)).size

  const send = useMutation({
    mutationFn: () =>
      window.api.notes.toNotebook({
        noteIds: entries.map((e) => e.id),
        notebookId,
        notebookTitle,
        pageId,
        pageTitle
      }),
    onSuccess: async (result) => {
      writePref(LAST_NOTEBOOK, String(result.notebookId))
      await Promise.all(['notebooks', 'notebook', 'page'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      setDone(result)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const chosenTitle = notebookId !== null ? notebooks.data?.find((n) => n.id === notebookId)?.title : notebookTitle

  return (
    <Modal
      open
      onClose={onClose}
      title="Enviar para caderno"
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={() => (onClose(), navigate(`/notebooks/${done.notebookId}?page=${done.pageId}`))}>
              <NotebookPen size={16} /> Abrir caderno
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => send.mutate()}
              disabled={send.isPending || entries.length === 0 || (notebookId === null && !notebookTitle.trim()) || (pageId === null && !pageTitle.trim())}
            >
              {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <NotebookPen size={16} />} Enviar
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
          <span>
            {plural(done.notes, 'anotação enviada', 'anotações enviadas')} para <b>{chosenTitle}</b>. Os horários viram links que
            abrem o vídeo no ponto certo, e o texto pode ser editado no caderno.
          </span>
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {plural(entries.length, 'anotação', 'anotações')} de {plural(lessons, 'aula')}. Cada aula vira um atalho para o vídeo, seguido das
            anotações com os horários clicáveis.
          </p>
          <div>
            <Label htmlFor="send-notebook">Caderno</Label>
            <select
              id="send-notebook"
              value={notebookId !== null ? String(notebookId) : NEW}
              onChange={(e) => {
                setNotebook(e.target.value)
                setPage(NEW)
              }}
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm"
            >
              <option value={NEW}>Novo caderno…</option>
              {notebooks.data?.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
            {notebookId === null && (
              <TextInput
                aria-label="Nome do caderno novo"
                value={notebookTitle}
                onChange={(e) => setNotebookTitle(e.target.value)}
                className="mt-2"
                data-autofocus
              />
            )}
          </div>
          <div>
            <Label htmlFor="send-page">Página</Label>
            {notebookId !== null && (
              <select
                id="send-page"
                value={pageId !== null ? String(pageId) : NEW}
                onChange={(e) => setPage(e.target.value)}
                className="mb-2 h-9 w-full rounded-md border border-border bg-bg px-3 text-sm"
              >
                <option value={NEW}>Nova página…</option>
                {detail.data?.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    No fim de “{p.title}”
                  </option>
                ))}
              </select>
            )}
            {pageId === null && (
              <TextInput
                id={notebookId === null ? 'send-page' : undefined}
                aria-label="Título da página nova"
                value={pageTitle}
                onChange={(e) => setPageTitle(e.target.value)}
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
