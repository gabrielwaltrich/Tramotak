import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Columns3, Loader2, Plus } from 'lucide-react'
import { dayKey } from '@shared/streak'
import { queryKeys } from '../lib/api'
import { readPref, writePref } from '../storage'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { KanbanBoard } from '../components/planner/KanbanBoard'
import { MonthCalendar } from '../components/planner/MonthCalendar'
import { TaskDialog, type TaskDialogState } from '../components/planner/TaskDialog'
import { PlanCard } from '../components/planner/PlanCard'

type View = 'kanban' | 'calendar'
const VIEW_KEY = 'tramotak.planner.view'

export function PlannerPage() {
  const [view, setView] = useState<View>(() => (readPref(VIEW_KEY) === 'calendar' ? 'calendar' : 'kanban'))
  const [dialog, setDialog] = useState<TaskDialogState>(null)
  const now = new Date()
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState(dayKey(now))
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => window.api.tasks.list(), staleTime: 0 })
  const plans = useQuery({ queryKey: queryKeys.plans, queryFn: () => window.api.plans.list(), staleTime: 0 })

  const choose = (v: View) => {
    setView(v)
    writePref(VIEW_KEY, v)
  }

  const tab = (v: View, label: string, Icon: typeof Columns3) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => choose(v)}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${view === v ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
    >
      <Icon size={16} /> {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Planner"
        subtitle="Planeje blocos de estudo, prazos e acompanhe o que está em andamento"
        actions={
          <Button onClick={() => setDialog({ mode: 'create', preset: view === 'calendar' ? { scheduledDate: selected } : undefined })}>
            <Plus size={16} /> Nova tarefa
          </Button>
        }
      />
      {plans.data && plans.data.length > 0 && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {plans.data.map((plan) => (
            <PlanCard key={plan.id} plan={plan} compact />
          ))}
        </div>
      )}
      <div role="tablist" aria-label="Visão" className="mb-4 inline-flex rounded-lg border border-border p-1">
        {tab('kanban', 'Quadro', Columns3)}
        {tab('calendar', 'Calendário', CalendarDays)}
      </div>

      {tasks.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : view === 'kanban' ? (
        <KanbanBoard tasks={tasks.data ?? []} onOpen={(task) => setDialog({ mode: 'edit', task })} />
      ) : (
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          selected={selected}
          onSelect={setSelected}
          onOpenTask={(task) => setDialog({ mode: 'edit', task })}
          onCreate={(date) => setDialog({ mode: 'create', preset: { scheduledDate: date } })}
        />
      )}

      <TaskDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}
