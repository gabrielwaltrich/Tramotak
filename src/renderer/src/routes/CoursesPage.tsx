import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Loader2, Plus, Search, SearchX } from 'lucide-react'
import type { CourseSort, CourseSummary } from '@shared/course'
import { percent, plural } from '@shared/format'
import { matches } from '@shared/search'
import { errorMessage, queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { TextInput } from '../components/Field'
import { CourseCard } from '../components/CourseCard'
import { ImportDialog } from '../components/ImportDialog'
import { EditCourseDialog } from '../components/EditCourseDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'

const SORTS: { value: CourseSort; label: string }[] = [
  { value: 'recent', label: 'Recentes' },
  { value: 'title', label: 'Título' },
  { value: 'progress', label: 'Progresso' }
]

function sortCourses(courses: CourseSummary[], sort: CourseSort): CourseSummary[] {
  if (sort === 'recent') return courses // o main já devolve por uso recente
  const sorted = [...courses]
  if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true }))
  else sorted.sort((a, b) => percent(b.completedCount, b.lessonCount) - percent(a.completedCount, a.lessonCount))
  return sorted
}

function describeRevalidation(r: { added: number; removed: number; updated: number }): string {
  const parts = [
    r.added && plural(r.added, 'aula nova', 'aulas novas'),
    r.removed && plural(r.removed, 'removida', 'removidas'),
    r.updated && plural(r.updated, 'atualizada', 'atualizadas')
  ].filter(Boolean)
  return parts.length ? `Pasta revalidada: ${parts.join(', ')}` : 'Pasta revalidada: nada mudou'
}

export function CoursesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  // ?import=1 (boas-vindas, Primeiros passos) já abre a importação; fechar tira o parâmetro.
  const [params, setParams] = useSearchParams()
  const wantsImport = params.get('import') === '1'
  const [importOpen, setImportOpen] = useState(false)
  const importing = importOpen || wantsImport
  const setImporting = (value: boolean) => {
    setImportOpen(value)
    if (!value && wantsImport) setParams({}, { replace: true })
  }
  const [editing, setEditing] = useState<CourseSummary | null>(null)
  const [deleting, setDeleting] = useState<CourseSummary | null>(null)
  const [revalidating, setRevalidating] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CourseSort>('recent')

  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list() })

  const visible = useMemo(
    () => sortCourses((courses.data ?? []).filter((c) => matches(query, c.title, c.rootPath)), sort),
    [courses.data, query, sort]
  )

  const remove = useMutation({
    mutationFn: (id: number) => window.api.courses.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast(`“${deleting?.title}” excluído`)
      setDeleting(null)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  // Vários cartões podem revalidar ao mesmo tempo.
  const revalidate = async (course: CourseSummary) => {
    setRevalidating((s) => new Set(s).add(course.id))
    try {
      const result = await window.api.courses.revalidate(course.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast(describeRevalidation(result))
    } catch (error) {
      toast(`${course.title}: ${errorMessage(error)}`, 'error')
    } finally {
      setRevalidating((s) => {
        const next = new Set(s)
        next.delete(course.id)
        return next
      })
    }
  }

  const relocate = async (course: CourseSummary) => {
    setRevalidating((s) => new Set(s).add(course.id))
    try {
      const result = await window.api.courses.relocate(course.id)
      if (!result) return
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast(`${course.title}: pasta trocada · ${plural(result.kept, 'aula mantida', 'aulas mantidas')}${result.added ? ` · ${result.added} nova(s)` : ''}${result.removed ? ` · ${result.removed} não encontrada(s)` : ''}`)
    } catch (error) {
      toast(`${course.title}: ${errorMessage(error)}`, 'error')
    } finally {
      setRevalidating((s) => {
        const next = new Set(s)
        next.delete(course.id)
        return next
      })
    }
  }

  const list = courses.data ?? []

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Meus Cursos"
        subtitle={list.length ? plural(list.length, 'curso') : 'Seus cursos importados'}
        actions={
          <Button onClick={() => setImporting(true)}>
            <Plus size={16} /> Importar
          </Button>
        }
      />

      {courses.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : courses.isError ? (
        <p className="text-sm text-red-400">{errorMessage(courses.error)}</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title="Sua biblioteca está vazia"
          description="Escolha uma pasta com as aulas do curso. O Tramotak detecta módulos, aulas, legendas e anexos automaticamente."
          action={<Button onClick={() => setImporting(true)}>Importar seu primeiro curso</Button>}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por título ou pasta…"
                className="pl-9"
                aria-label="Buscar cursos"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CourseSort)}
              aria-label="Ordenar"
              className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-text"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={<SearchX size={22} />} title="Nenhum curso encontrado" description={`Nada corresponde a “${query}”.`} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5">
              {visible.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  revalidating={revalidating.has(course.id)}
                  onEdit={() => setEditing(course)}
                  onRevalidate={() => revalidate(course)}
                  onRelocate={() => relocate(course)}
                  onDelete={() => setDeleting(course)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ImportDialog open={importing} onClose={() => setImporting(false)} onImported={(id) => {
        setImporting(false)
        navigate(`/courses/${id}`)
      }} />
      <EditCourseDialog course={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Excluir curso"
        confirmLabel="Excluir"
        busy={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p>
          Excluir <strong className="text-text">“{deleting?.title}”</strong> da biblioteca? O progresso e as anotações
          deste curso serão apagados.
        </p>
        <p className="mt-2">Os arquivos no seu computador não são tocados.</p>
      </ConfirmDialog>
    </div>
  )
}
