import { Link } from 'react-router'
import { CheckCircle2, Circle } from 'lucide-react'
import type { PlanLessonRef } from '@shared/studyPlan'

/** Aulas de um dia do plano de estudos, com o que já foi concluído e atalho para abrir cada uma. */
export function PlanLessons({ lessons, compact = false, limit }: { lessons: PlanLessonRef[]; compact?: boolean; limit?: number }) {
  const shown = limit !== undefined ? lessons.slice(0, limit) : lessons
  return (
    <ul className={`min-w-0 ${compact ? 'mt-1 space-y-0.5' : 'space-y-1'}`}>
      {shown.map((l) => (
        <li key={l.id} className="flex min-w-0 items-center gap-2 text-sm">
          {l.completed ? (
            <CheckCircle2 size={14} className="shrink-0 text-success" aria-label="Concluída" />
          ) : (
            <Circle size={14} className="shrink-0 text-muted" aria-label="Pendente" />
          )}
          <Link
            to={`/lesson/${l.id}`}
            title={l.title}
            className={`min-w-0 truncate hover:text-accent hover:underline ${l.completed ? 'text-muted line-through' : ''} ${compact ? 'text-xs' : ''}`}
          >
            {l.title}
          </Link>
        </li>
      ))}
      {shown.length < lessons.length && (
        <li className={`pl-[22px] text-muted ${compact ? 'text-xs' : 'text-sm'}`}>e mais {lessons.length - shown.length}</li>
      )}
    </ul>
  )
}
