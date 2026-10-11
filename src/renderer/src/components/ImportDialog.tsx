import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, FileText, FolderOpen, Loader2, PlayCircle, File } from 'lucide-react'
import type { Numbering, ScannedLesson, ScannedModule, ScanWarning, Structure } from '@shared/course'
import { formatBytes, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Label, Segmented, TextInput } from './Field'
import { useToast } from './Toast'

const STRUCTURES: { value: Structure; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'modules', label: 'Módulos > Aulas' },
  { value: 'submodules', label: 'Módulos > Submódulos > Aulas' },
  { value: 'flat', label: 'Arquivos na raiz' }
]

const NUMBERINGS: { value: Numbering; label: string }[] = [
  { value: 'dot', label: '“1. Nome”' },
  { value: 'dash', label: '“1 - Nome”' },
  { value: 'none', label: 'Sem número' }
]

const WARNING_LABEL: Record<ScanWarning['code'], string> = {
  empty: 'Nenhuma aula encontrada',
  'maybe-unsupported': 'Vídeos que podem não tocar',
  flattened: 'Subpastas juntadas no nível acima',
  'long-path': 'Caminhos longos (podem falhar no Windows)',
  unreadable: 'Pastas sem permissão de leitura'
}

function LessonIcon({ lesson }: { lesson: ScannedLesson }) {
  const cls = 'shrink-0 text-muted'
  if (lesson.kind === 'video') return <PlayCircle size={14} className={cls} />
  if (lesson.kind === 'text') return <FileText size={14} className={cls} />
  return <File size={14} className={cls} />
}

function LessonRow({ lesson }: { lesson: ScannedLesson }) {
  const subs = lesson.assets.filter((a) => a.kind === 'subtitle').length
  const files = lesson.assets.length - subs
  return (
    <li className="flex items-center gap-2 py-0.5 text-sm">
      <LessonIcon lesson={lesson} />
      <span className="truncate">{lesson.title}</span>
      <span className="ml-auto shrink-0 text-xs text-muted">
        {[subs && 'CC', files && plural(files, 'anexo')].filter(Boolean).join(' · ')}
      </span>
    </li>
  )
}

function countLessons(m: ScannedModule): number {
  return m.lessons.length + m.children.reduce((n, c) => n + countLessons(c), 0)
}

function ModuleRow({ module, depth }: { module: ScannedModule; depth: number }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded py-1 text-left text-sm hover:bg-surface-2"
        aria-expanded={open}
      >
        <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="truncate font-medium">{module.title}</span>
        <span className="ml-auto shrink-0 pr-1 text-xs text-muted">{plural(countLessons(module), 'aula')}</span>
      </button>
      {open && (
        <ul className="ml-5 border-l border-border pl-3">
          {module.lessons.map((l) => (
            <LessonRow key={l.relPath} lesson={l} />
          ))}
          {module.children.map((c) => (
            <ModuleRow key={c.relPath} module={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Warnings({ warnings }: { warnings: ScanWarning[] }) {
  const groups = new Map<ScanWarning['code'], ScanWarning[]>()
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w])
  if (groups.size === 0) return null

  return (
    <div className="space-y-1.5">
      {[...groups].map(([code, items]) => (
        <details key={code} className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 text-warning">
            <AlertTriangle size={14} className="shrink-0" />
            {WARNING_LABEL[code]}
            {items.some((i) => i.relPath) && <span className="text-xs opacity-80">({items.length})</span>}
          </summary>
          {items.some((i) => i.relPath) && (
            <ul className="mt-1.5 max-h-28 overflow-y-auto pl-6 text-xs text-muted select-text">
              {items.map((i, n) => (
                <li key={n} className="truncate">{i.relPath}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  )
}

export function ImportDialog({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: (courseId: number) => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [structure, setStructure] = useState<Structure>('auto')
  const [numbering, setNumbering] = useState<Numbering>('dot')
  const queryClient = useQueryClient()
  const toast = useToast()

  const preview = useQuery({
    queryKey: ['preview', path, structure, numbering],
    queryFn: () => window.api.scanner.preview({ path: path!, structure, numbering }),
    enabled: open && !!path,
    staleTime: 0,
    gcTime: 0
  })

  const effectiveTitle = titleEdited ? title : (preview.data?.suggestedTitle ?? '')

  const importCourse = useMutation({
    mutationFn: () => window.api.courses.import({ path: path!, title: effectiveTitle, structure, numbering }),
    onSuccess: async (courseId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast(`“${effectiveTitle}” importado`)
      reset()
      onImported(courseId)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  function reset() {
    setPath(null)
    setTitle('')
    setTitleEdited(false)
    setStructure('auto')
    setNumbering('dot')
  }

  const close = () => {
    if (importCourse.isPending) return
    reset()
    onClose()
  }

  const pick = async () => {
    const chosen = await window.api.dialog.pickFolder()
    if (chosen) {
      setPath(chosen)
      setTitleEdited(false)
    }
  }

  const scan = preview.data?.scan
  const alreadyImported = preview.data?.existingCourseId != null
  const canImport =
    !!scan && scan.stats.lessons > 0 && !alreadyImported && effectiveTitle.trim() !== '' && !preview.isFetching

  return (
    <Modal
      open={open}
      onClose={close}
      title="Importar curso"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={importCourse.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => importCourse.mutate()} disabled={!canImport || importCourse.isPending}>
            {importCourse.isPending && <Loader2 size={16} className="animate-spin" />}
            Importar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <Label>Pasta</Label>
          <div className="flex gap-2">
            <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-border bg-bg px-3 text-sm">
              <span className={`truncate ${path ? 'select-text' : 'text-muted'}`} title={path ?? undefined}>
                {path ?? 'Nenhuma pasta escolhida'}
              </span>
            </div>
            <Button variant="ghost" onClick={pick} data-autofocus>
              <FolderOpen size={16} /> Escolher pasta
            </Button>
          </div>
        </div>

        {path && (
          <>
            <div>
              <Label htmlFor="course-title">Título</Label>
              <TextInput
                id="course-title"
                value={effectiveTitle}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setTitleEdited(true)
                }}
                placeholder="Nome do curso"
              />
            </div>

            <div>
              <Label>Estrutura das pastas</Label>
              <Segmented label="Estrutura das pastas" value={structure} options={STRUCTURES} onChange={setStructure} />
            </div>

            <div>
              <Label>Numeração dos arquivos</Label>
              <Segmented label="Numeração" value={numbering} options={NUMBERINGS} onChange={setNumbering} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label>Prévia</Label>
                {preview.isFetching && <Loader2 size={14} className="animate-spin text-muted" />}
              </div>

              {preview.isError && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {errorMessage(preview.error)}
                </p>
              )}

              {scan && (
                <div className="space-y-3">
                  {alreadyImported && (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                      Esta pasta já foi importada. Use “Revalidar” no cartão do curso para atualizar.
                    </p>
                  )}
                  <Warnings warnings={scan.warnings} />
                  {scan.stats.lessons > 0 && (
                    <>
                      <ul className="max-h-64 overflow-y-auto rounded-md border border-border bg-bg p-2">
                        {scan.lessons.map((l) => (
                          <LessonRow key={l.relPath} lesson={l} />
                        ))}
                        {scan.modules.map((m) => (
                          <ModuleRow key={m.relPath} module={m} depth={0} />
                        ))}
                      </ul>
                      <p className="text-xs text-muted">
                        {[
                          scan.stats.modules > 0 && plural(scan.stats.modules, 'módulo'),
                          plural(scan.stats.lessons, 'aula'),
                          scan.stats.subtitles > 0 && plural(scan.stats.subtitles, 'legenda'),
                          scan.stats.attachments > 0 && plural(scan.stats.attachments, 'anexo'),
                          formatBytes(scan.stats.totalBytes)
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {structure === 'auto' && ` · estrutura detectada: ${STRUCTURES.find((s) => s.value === scan.structure)?.label}`}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
