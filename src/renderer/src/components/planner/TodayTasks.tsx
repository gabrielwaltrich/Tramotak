import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import type { Task } from '@shared/planner'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { useToast } from '../Toast'
import { TaskMeta } from './TaskMeta'
import { PlanLessons } from './PlanLessons'

/** Painel "Hoje" do Início: tarefas de hoje e atrasadas, concluídas com um clique. */
export function TodayTasks() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const today = useQuery({ queryKey: queryKeys.tasksToday, queryFn: () => window.api.tasks.today(), staleTime: 0 })

  const done = useMutation({
    mutationFn: (task: Task) => window.api.tasks.setDone(task.id, true),
    onMutate: (task) => queryClient.setQueryData<Task[]>(queryKeys.tasksToday, (list) => list?.filter((t) => t.id !== task.id)),
    onSuccess: (_r, task) => toast(`“${task.title}” concluída`),
    // Se falhar, a lista volta do servidor ("desfazer" automático).
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
  })

  const list = today.data ?? []
  if (list.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted uppercase">
          <CalendarCheck size={14} /> Hoje · {plural(list.length, 'tarefa')}
        </p>
        <Link to="/planner" className="text-sm text-accent hover:underline">
          Abrir planner
        </Link>
      </div>
      <ul className="space-y-1">
        {list.map((t) => (
          <li key={t.id} className="flex items-start gap-3 rounded-md px-1 py-1.5">
            <input
              type="checkbox"
              onChange={() => done.mutate(t)}
              aria-label={`Concluir ${t.title}`}
              className="mt-0.5 size-4 cursor-pointer accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm [overflow-wrap:anywhere]">{t.title}</p>
              <TaskMeta task={t} />
              {t.planLessons && t.planLessons.length > 1 && <PlanLessons lessons={t.planLessons} compact limit={6} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
