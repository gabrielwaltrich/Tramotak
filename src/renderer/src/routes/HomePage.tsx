import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CloudOff, FileText, Flame, FolderPlus, Layers, Play } from 'lucide-react'
import type { DashboardData } from '@shared/course'
import { formatClock, percent, plural } from '@shared/format'
import { formatLongDate, greeting } from '@shared/greeting'
import { queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { CourseCard } from '../components/CourseCard'
import { GoalCard } from '../components/GoalCard'
import { TodayTasks } from '../components/planner/TodayTasks'
import { FirstSteps } from '../components/onboarding/FirstSteps'

function StreakChip({ streak }: { streak: DashboardData['streak'] }) {
  const { current, todayDone, best } = streak
  const label = current === 0 ? 'Comece sua sequência' : plural(current, 'dia')
  const title =
    current === 0 ? 'Estude pelo menos 1 minuto hoje para começar'
    : todayDone ? `Sequência de ${plural(current, 'dia')} · recorde: ${plural(best, 'dia')}`
    : 'Estude hoje para não perder a sequência'
  return (
    <div
      title={title}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
        todayDone ? 'border-orange-400/40 bg-orange-400/10 text-orange-400'
        : current > 0 ? 'border-border text-muted'
        : 'border-border text-muted'
      }`}
    >
      <Flame size={16} fill={todayDone ? 'currentColor' : 'none'} />
      {label}
      {current > 0 && !todayDone && <span className="text-xs">· estude hoje</span>}
    </div>
  )
}

function ContinueCard({ lesson }: { lesson: NonNullable<DashboardData['continueLesson']> }) {
  const navigate = useNavigate()
  const open = () => navigate(`/lesson/${lesson.lessonId}`)
  const progress = lesson.durationSec ? percent(lesson.positionSec, lesson.durationSec) : 0
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <p className="mb-3 text-xs font-medium tracking-wider text-muted uppercase">
        {lesson.isNext ? 'Próxima aula' : 'Continuar assistindo'}
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={open}
          aria-label={`Abrir ${lesson.title}`}
          className="grid size-14 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent hover:brightness-125"
        >
          {lesson.kind === 'video' ? <Play size={22} fill="currentColor" /> : <FileText size={22} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {lesson.moduleTitle ? `${lesson.moduleTitle} · ` : ''}
            {lesson.title}
          </p>
          <p className="truncate text-sm text-muted">{lesson.courseTitle}</p>
          {lesson.kind === 'video' && lesson.durationSec !== null && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {formatClock(lesson.positionSec)} / {formatClock(lesson.durationSec)}
              </span>
            </div>
          )}
        </div>
        <Button onClick={open}>{lesson.isNext || lesson.positionSec === 0 ? 'Assistir' : 'Continuar'}</Button>
      </div>
    </section>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const now = new Date()
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => window.api.dashboard.get(), staleTime: 0 })
  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list() })
  const list = courses.data ?? []
  const d = dashboard.data

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title={`${greeting(now.getHours())} 👋`}
        subtitle={formatLongDate(now)}
        actions={d && <StreakChip streak={d.streak} />}
      />

      <div className="mb-8 space-y-4">
        {d?.backupWarning && (
          <section role="alert" className="flex items-center gap-4 rounded-xl border border-red-400/40 bg-red-400/5 p-5">
            <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-red-400/10 text-red-400">
              <CloudOff size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">A pasta de backup não recebe cópias há {plural(d.backupWarning.days, 'dia')}</p>
              <p className="text-sm text-muted">{d.backupWarning.error}</p>
            </div>
            <Button variant="ghost" onClick={() => navigate('/settings#backup')}>
              Ver backup
            </Button>
          </section>
        )}
        <FirstSteps />
        {d && <GoalCard todaySeconds={d.todaySeconds} goalMinutes={d.goalMinutes} lessonsCompletedToday={d.lessonsCompletedToday} />}
        <TodayTasks />
        {d && d.cardsDueToday > 0 && (
          <section className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5">
            <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-400">
              <Layers size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Flashcards para hoje</p>
              <p className="text-sm text-muted">{plural(d.cardsDueToday, 'carta')} esperando revisão</p>
            </div>
            <Button onClick={() => navigate('/flashcards')}>Revisar</Button>
          </section>
        )}
        {d?.continueLesson ? (
          <ContinueCard lesson={d.continueLesson} />
        ) : (
          list.length > 0 &&
          list[0].resumeLessonId !== null && (
            <section className="flex items-center justify-between rounded-xl border border-border bg-surface p-5">
              <div>
                <p className="font-medium">Comece a estudar</p>
                <p className="text-sm text-muted">{list[0].title}</p>
              </div>
              <Button onClick={() => navigate(`/lesson/${list[0].resumeLessonId}`)}>
                <Play size={16} fill="currentColor" /> Começar
              </Button>
            </section>
          )
        )}
      </div>

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
