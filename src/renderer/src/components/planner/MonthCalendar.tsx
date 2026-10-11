import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Flag, Layers, Plus } from 'lucide-react'
import type { CalendarDay, Task } from '@shared/planner'
import { plural } from '@shared/format'
import { dayKey } from '@shared/streak'
import { queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { TaskMeta } from './TaskMeta'

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MAX_CHIPS = 3

/** Grade de 6 semanas começando no domingo antes do dia 1. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))
}

export function MonthCalendar({ month, onMonth, selected, onSelect, onOpenTask, onCreate }: {
  month: { year: number; month: number }
  onMonth: (m: { year: number; month: number }) => void
  selected: string
  onSelect: (date: string) => void
  onOpenTask: (task: Task) => void
  onCreate: (date: string) => void
}) {
  const grid = useMemo(() => monthGrid(month.year, month.month), [month])
  const from = grid[0]
  const to = grid[grid.length - 1]
  const days = useQuery({ queryKey: queryKeys.calendar(from, to), queryFn: () => window.api.tasks.calendar(from, to), staleTime: 0 })
  const byDate = useMemo(() => new Map((days.data ?? []).map((d) => [d.date, d])), [days.data])
  const today = dayKey(new Date())
  const label = new Date(month.year, month.month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const shift = (delta: number) => {
    const d = new Date(month.year, month.month + delta, 1)
    onMonth({ year: d.getFullYear(), month: d.getMonth() })
  }
  const day: CalendarDay | undefined = byDate.get(selected)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_18rem] gap-4">
      <section className="rounded-xl border border-border bg-surface p-3">
        <header className="mb-2 flex items-center gap-2 px-1">
          <h2 className="flex-1 font-medium first-letter:uppercase">{label}</h2>
          <Button
            variant="ghost"
            className="h-8 px-3"
            onClick={() => {
              const now = new Date()
              onMonth({ year: now.getFullYear(), month: now.getMonth() })
              onSelect(today)
            }}
          >
            Hoje
          </Button>
          <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
            <ChevronRight size={18} />
          </button>
        </header>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-surface py-1.5 text-center text-xs text-muted">
              {w}
            </div>
          ))}
          {grid.map((key) => {
            const d = byDate.get(key)
            const inMonth = Number(key.slice(5, 7)) - 1 === month.month
            const extra = (d?.tasks.length ?? 0) - MAX_CHIPS
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                onDoubleClick={() => onCreate(key)}
                aria-label={`${key}${d?.tasks.length ? `, ${plural(d.tasks.length, 'tarefa')}` : ''}${d?.reviewsDue ? `, ${d.reviewsDue} revisões` : ''}`}
                aria-pressed={key === selected}
                className={`flex min-h-24 flex-col gap-1 p-1.5 text-left align-top ${inMonth ? 'bg-surface' : 'bg-surface/60'} ${
                  key === selected ? 'ring-2 ring-accent ring-inset' : 'hover:bg-surface-2'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={`grid size-6 place-items-center rounded-full text-xs tabular-nums ${
                      key === today ? 'bg-accent font-semibold text-on-accent' : inMonth ? 'text-text' : 'text-muted/60'
                    }`}
                  >
                    {Number(key.slice(8))}
                  </span>
                  <span className="flex items-center gap-1">
                    {d && d.dueTasks.length > 0 && <Flag size={11} className="text-red-400" aria-hidden />}
                    {d && d.reviewsDue > 0 && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-sky-400/10 px-1 text-[10px] text-sky-400 tabular-nums">
                        <Layers size={10} /> {d.reviewsDue}
                      </span>
                    )}
                  </span>
                </span>
                {d?.tasks.slice(0, MAX_CHIPS).map((t) => (
                  <span
                    key={t.id}
                    className={`truncate rounded px-1 py-0.5 text-[11px] ${
                      t.status === 'done' ? 'bg-surface-2 text-muted line-through' : 'bg-accent-soft text-text'
                    }`}
                  >
                    {t.scheduledTime && <span className="tabular-nums">{t.scheduledTime} </span>}
                    {t.title}
                  </span>
                ))}
                {extra > 0 && <span className="px-1 text-[11px] text-muted">+{extra}</span>}
              </button>
            )
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-muted">Clique para ver o dia · duplo clique cria uma tarefa · <Layers size={10} className="inline" /> revisões de flashcards previstas</p>
      </section>

      <aside className="flex flex-col rounded-xl border border-border bg-surface">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-medium first-letter:uppercase">
            {new Date(`${selected}T12:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <button type="button" onClick={() => onCreate(selected)} aria-label="Nova tarefa neste dia" className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
            <Plus size={16} />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {day && day.reviewsDue > 0 && (
            <p className="flex items-center gap-2 text-sky-400">
              <Layers size={14} /> {plural(day.reviewsDue, 'revisão prevista', 'revisões previstas')}
            </p>
          )}
          {day && day.tasks.length > 0 && (
            <ul className="space-y-2">
              {day.tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t)} className="w-full rounded-lg border border-border p-2.5 text-left hover:border-accent/50">
                    <p className={t.status === 'done' ? 'text-muted line-through' : ''}>{t.title}</p>
                    <div className="mt-1">
                      <TaskMeta task={t} hideDate />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {day && day.dueTasks.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wider text-muted uppercase">Prazos</p>
              <ul className="space-y-1">
                {day.dueTasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTask(t)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface-2">
                      <Flag size={12} className="shrink-0 text-red-400" />
                      <span className={`truncate ${t.status === 'done' ? 'text-muted line-through' : ''}`}>{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!day || (day.tasks.length === 0 && day.dueTasks.length === 0 && day.reviewsDue === 0)) && (
            <p className="py-6 text-center text-muted">Nada neste dia.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
