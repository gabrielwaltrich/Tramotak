import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, File, FileText, Loader2, Play, PlayCircle } from 'lucide-react'
import type { CourseLesson, CourseModuleNode } from '@shared/course'
import { formatDuration, percent, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { useDurationProbe } from '../lib/useDurationProbe'
import { Button } from '../components/Button'

function countLessons(m: CourseModuleNode): { total: number; done: number } {
  return m.children.reduce(
    (acc, c) => {
      const sub = countLessons(c)
      return { total: acc.total + sub.total, done: acc.done + sub.done }
    },
    { total: m.lessons.length, done: m.lessons.filter((l) => l.completed).length }
  )
}

function LessonItem({ lesson }: { lesson: CourseLesson }) {
  const Icon = lesson.kind === 'video' ? PlayCircle : lesson.kind === 'text' ? FileText : File
  return (
    <li>
      <Link to={`/lesson/${lesson.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-2">
        {lesson.completed ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-muted" />}
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="truncate">{lesson.title}</span>
        {lesson.durationSec !== null && (
          <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">{formatDuration(lesson.durationSec)}</span>
        )}
      </Link>
    </li>
  )
}

function ModuleSection({ module, defaultOpen }: { module: CourseModuleNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const { total, done } = countLessons(module)
  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronRight size={16} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 truncate font-medium">{module.title}</span>
        <span className={`text-xs tabular-nums ${done === total ? 'text-success' : 'text-muted'}`}>
          {done}/{total}
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5 px-2 pb-2">
          {module.lessons.map((l) => (
            <LessonItem key={l.id} lesson={l} />
          ))}
          {module.children.length > 0 && (
            <li>
              <ul className="space-y-2 pt-1 pl-4">
                {module.children.map((c) => (
                  <ModuleSection key={c.id} module={c} defaultOpen={false} />
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function CourseDetailPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const course = useQuery({ queryKey: queryKeys.course(id), queryFn: () => window.api.courses.get(id) })
  useDurationProbe(course.data)

  if (course.isPending) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (course.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(course.error)}</p>

  const c = course.data
  const progress = percent(c.completedCount, c.lessonCount)

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link to="/courses" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> Meus Cursos
      </Link>
      <header className="mb-6">
        <div className="flex items-start gap-4">
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">{c.title}</h1>
          {c.resumeLessonId !== null && (
            <Button onClick={() => navigate(`/lesson/${c.resumeLessonId}`)}>
              <Play size={16} fill="currentColor" /> {c.lastOpenedAt ? 'Continuar' : 'Começar'}
            </Button>
          )}
        </div>
        {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
        <p className="mt-2 text-sm text-muted">
          {[
            c.modules.length > 0 && plural(c.modules.length, 'módulo'),
            plural(c.lessonCount, 'aula'),
            c.durationSec > 0 && formatDuration(c.durationSec),
            `${progress}% concluído`
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {c.lessons.length > 0 && (
        <ul className="mb-3 space-y-0.5 rounded-lg border border-border bg-surface p-2">
          {c.lessons.map((l) => (
            <LessonItem key={l.id} lesson={l} />
          ))}
        </ul>
      )}
      <ul className="space-y-2">
        {c.modules.map((m, i) => (
          <ModuleSection key={m.id} module={m} defaultOpen={i === 0} />
        ))}
      </ul>
    </div>
  )
}
