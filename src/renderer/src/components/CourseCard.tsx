import { useNavigate } from 'react-router'
import { MoreVertical, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { CourseSummary } from '@shared/course'
import { formatDuration, percent, plural } from '@shared/format'
import { Menu } from './Menu'

/** Cor estável por curso, para a capa gerada. */
function hue(title: string): number {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function CourseCard({ course, onEdit, onRevalidate, onDelete, revalidating = false }: {
  course: CourseSummary
  onEdit?: () => void
  onRevalidate?: () => void
  onDelete?: () => void
  revalidating?: boolean
}) {
  const navigate = useNavigate()
  const progress = percent(course.completedCount, course.lessonCount)
  const started = course.completedCount > 0 || course.lastOpenedAt !== null
  const h = hue(course.title)
  const meta = [
    course.durationSec > 0 ? formatDuration(course.durationSec) : plural(course.lessonCount, 'aula'),
    `${progress}%`
  ].join(' · ')

  const open = () => navigate(`/courses/${course.id}`)
  const resume = () => navigate(course.resumeLessonId !== null ? `/lesson/${course.resumeLessonId}` : `/courses/${course.id}`)

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent/50">
      <button type="button" onClick={open} className="text-left" aria-label={`Abrir ${course.title}`}>
        <div
          className="grid aspect-video place-items-center text-3xl font-semibold text-white/90"
          style={{ background: `linear-gradient(135deg, hsl(${h} 55% 38%), hsl(${(h + 40) % 360} 60% 22%))` }}
        >
          {initials(course.title)}
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
            <h3 className="line-clamp-2 font-medium leading-snug" title={course.title}>
              {course.title}
            </h3>
            <p className="mt-0.5 text-xs text-muted">{meta}</p>
          </button>
          {(onEdit || onRevalidate || onDelete) && (
            <Menu
              label={`Ações de ${course.title}`}
              trigger={<MoreVertical size={16} />}
              items={[
                ...(onEdit ? [{ label: 'Editar', icon: <Pencil size={14} />, onSelect: onEdit }] : []),
                ...(onRevalidate
                  ? [{ label: 'Revalidar pasta', icon: <RefreshCw size={14} />, onSelect: onRevalidate, disabled: revalidating }]
                  : []),
                ...(onDelete ? [{ label: 'Excluir', icon: <Trash2 size={14} />, onSelect: onDelete, danger: true }] : [])
              ]}
            />
          )}
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-label={`${progress}% concluído`}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>

        <button
          type="button"
          onClick={resume}
          className="mt-auto flex h-8 items-center justify-center gap-2 rounded-md bg-accent-soft text-sm font-medium text-accent hover:brightness-125"
        >
          {revalidating ? <RefreshCw size={14} className="animate-spin" /> : null}
          {revalidating ? 'Revalidando…' : started ? 'Continuar' : 'Começar'}
        </button>
      </div>
    </article>
  )
}
