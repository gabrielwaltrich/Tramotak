import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, ChevronRight, Circle, PlayCircle } from 'lucide-react'
import type { CourseDetail, CourseLesson, CourseModuleNode } from '@shared/course'
import { formatDuration, percent } from '@shared/format'

function containsLesson(m: CourseModuleNode, id: number): boolean {
  return m.lessons.some((l) => l.id === id) || m.children.some((c) => containsLesson(c, id))
}

function Item({ lesson, current }: { lesson: CourseLesson; current: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <li>
      <Link
        ref={ref}
        to={`/lesson/${lesson.id}`}
        aria-current={current ? 'page' : undefined}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
          current ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-2'
        }`}
      >
        {current ? (
          <PlayCircle size={15} className="shrink-0" />
        ) : lesson.completed ? (
          <CheckCircle2 size={15} className="shrink-0 text-success" />
        ) : (
          <Circle size={15} className="shrink-0 text-muted" />
        )}
        <span className="line-clamp-2 flex-1">{lesson.title}</span>
        {lesson.durationSec !== null && <span className="shrink-0 text-xs text-muted">{formatDuration(lesson.durationSec)}</span>}
      </Link>
    </li>
  )
}

function Module({ module, currentId }: { module: CourseModuleNode; currentId: number }) {
  // Abre sozinho o módulo da aula atual; um clique manual vale até a aula mudar.
  const [manual, setManual] = useState<{ lessonId: number; open: boolean } | null>(null)
  const open = manual?.lessonId === currentId ? manual.open : containsLesson(module, currentId)
  const setOpen = (fn: (open: boolean) => boolean) => setManual({ lessonId: currentId, open: fn(open) })

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-medium hover:bg-surface-2"
      >
        <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="truncate">{module.title}</span>
      </button>
      {open && (
        <ul className="ml-3 border-l border-border pl-2">
          {module.lessons.map((l) => (
            <Item key={l.id} lesson={l} current={l.id === currentId} />
          ))}
          {module.children.map((c) => (
            <Module key={c.id} module={c} currentId={currentId} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function LessonSidebar({ course, currentId }: { course: CourseDetail; currentId: number }) {
  const progress = percent(course.completedCount, course.lessonCount)
  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-surface">
      <div className="border-b border-border p-4">
        <Link to={`/courses/${course.id}`} className="line-clamp-2 font-medium hover:text-accent">
          {course.title}
        </Link>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
          {course.completedCount}/{course.lessonCount}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {course.lessons.map((l) => (
          <Item key={l.id} lesson={l} current={l.id === currentId} />
        ))}
        {course.modules.map((m) => (
          <Module key={m.id} module={m} currentId={currentId} />
        ))}
      </ul>
    </aside>
  )
}
