import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { TASK_STATUS_LABEL, type Task, type TaskStatus } from '@shared/planner'
import { errorMessage, queryKeys } from '../../lib/api'
import { useToast } from '../Toast'
import { TaskMeta } from './TaskMeta'

const COLUMNS: TaskStatus[] = ['todo', 'doing', 'done']
const DOT: Record<TaskStatus, string> = { todo: 'bg-muted', doing: 'bg-accent', done: 'bg-success' }

/** Índice de inserção pela posição do ponteiro em relação ao meio de cada cartão. */
function dropIndex(list: HTMLElement, clientY: number, draggingId: number | null): number {
  const cards = [...list.querySelectorAll<HTMLElement>('[data-task-id]')].filter((el) => Number(el.dataset.taskId) !== draggingId)
  const index = cards.findIndex((el) => {
    const rect = el.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2
  })
  return index < 0 ? cards.length : index
}

export function KanbanBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [dragging, setDragging] = useState<number | null>(null)
  const [target, setTarget] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [quick, setQuick] = useState('')

  const move = useMutation({
    mutationFn: (m: { id: number; status: TaskStatus; index: number }) => window.api.tasks.move(m.id, m.status, m.index),
    // Atualiza na hora; o servidor confirma a ordem final em seguida.
    onMutate: ({ id, status, index }) => {
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (old) => {
        if (!old) return old
        const task = old.find((t) => t.id === id)
        if (!task) return old
        const rest = old.filter((t) => t.id !== id)
        const column = rest.filter((t) => t.status === status)
        column.splice(index, 0, { ...task, status })
        return [...rest.filter((t) => t.status !== status), ...column.map((t, i) => ({ ...t, position: i }))]
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const create = useMutation({
    mutationFn: (title: string) => window.api.tasks.create({ title }),
    onSuccess: () => {
      setQuick('')
      return queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <div className="grid grid-cols-3 gap-4">
      {COLUMNS.map((status) => {
        const column = tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position)
        return (
          <section
            key={status}
            aria-label={TASK_STATUS_LABEL[status]}
            className={`flex min-h-64 flex-col rounded-xl border bg-surface ${target?.status === status ? 'border-accent/60' : 'border-border'}`}
            onDragOver={(e) => {
              if (dragging === null) return
              e.preventDefault()
              const list = e.currentTarget.querySelector<HTMLElement>('[data-list]')!
              setTarget({ status, index: dropIndex(list, e.clientY, dragging) })
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setTarget(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging !== null && target) move.mutate({ id: dragging, ...target })
              setDragging(null)
              setTarget(null)
            }}
          >
            <header className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-medium">
              <span className={`size-2 rounded-full ${DOT[status]}`} />
              {TASK_STATUS_LABEL[status]}
              <span className="text-xs font-normal text-muted">{column.length}</span>
            </header>

            {status === 'todo' && (
              <form
                className="px-3 pb-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (quick.trim()) create.mutate(quick)
                }}
              >
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 focus-within:border-accent">
                  <Plus size={14} className="text-muted" />
                  <input
                    value={quick}
                    onChange={(e) => setQuick(e.target.value)}
                    placeholder="Adicionar tarefa…"
                    aria-label="Adicionar tarefa rápida"
                    className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted select-text focus-visible:outline-none"
                  />
                </div>
              </form>
            )}

            <ul data-list className="flex flex-1 flex-col gap-2 px-3 pb-3">
              {column.map((task, i) => (
                <li key={task.id}>
                  {target?.status === status && target.index === i && dragging !== task.id && <div className="mb-2 h-0.5 rounded bg-accent" />}
                  <button
                    type="button"
                    data-task-id={task.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(task.id))
                      setDragging(task.id)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setTarget(null)
                    }}
                    onClick={() => onOpen(task)}
                    className={`w-full cursor-grab rounded-lg border border-border bg-bg p-3 text-left hover:border-accent/50 active:cursor-grabbing ${
                      dragging === task.id ? 'opacity-40' : ''
                    }`}
                  >
                    <p className={`text-sm ${status === 'done' ? 'text-muted line-through' : ''}`}>{task.title}</p>
                    <div className="mt-1.5">
                      <TaskMeta task={task} />
                    </div>
                  </button>
                </li>
              ))}
              {target?.status === status && target.index >= column.filter((t) => t.id !== dragging).length && (
                <li className="h-0.5 rounded bg-accent" />
              )}
              {column.length === 0 && !target && <li className="py-6 text-center text-xs text-muted">Arraste tarefas para cá</li>}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
