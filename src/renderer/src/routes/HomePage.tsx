import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { formatLongDate, greeting } from '@shared/greeting'
import { queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { CourseCard } from '../components/CourseCard'

export function HomePage() {
  const navigate = useNavigate()
  const now = new Date()
  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list() })
  const list = courses.data ?? []

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader title={`${greeting(now.getHours())} 👋`} subtitle={formatLongDate(now)} />

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Hoje até agora</span>
          <span className="tabular-nums text-muted">0 / 60 min</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-0 rounded-full bg-accent" />
        </div>
      </section>

      {courses.isSuccess && list.length === 0 && (
        <EmptyState
          icon={<FolderPlus size={22} />}
          title="Nenhum curso ainda"
          description="Importe a pasta de um curso que já está no seu computador para começar a estudar."
          action={<Button onClick={() => navigate('/courses')}>Importar seu primeiro curso</Button>}
        />
      )}

      {list.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Seus cursos</h2>
            <button type="button" onClick={() => navigate('/courses')} className="text-sm text-accent hover:underline">
              Ver todos
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
            {list.slice(0, 4).map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
