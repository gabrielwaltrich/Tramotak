import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, X } from 'lucide-react'
import { percent, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { useToast } from './Toast'

export const GOAL_MIN = 5
export const GOAL_MAX = 480

/** Meta diária: minutos de hoje × meta, editável no próprio cartão. */
export function GoalCard({ todaySeconds, goalMinutes, lessonsCompletedToday }: {
  todaySeconds: number
  goalMinutes: number
  lessonsCompletedToday: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(goalMinutes))
  const queryClient = useQueryClient()
  const toast = useToast()
  const minutes = Math.floor(todaySeconds / 60)
  const reached = minutes >= goalMinutes
  const progress = Math.min(100, percent(minutes, goalMinutes))

  const save = useMutation({
    mutationFn: () => window.api.settings.update({ dailyGoalMinutes: Number(draft) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      ])
      setEditing(false)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Hoje até agora</span>
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
          >
            <span className="tabular-nums text-muted">{minutes} /</span>
            <input
              type="number"
              min={GOAL_MIN}
              max={GOAL_MAX}
              step={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              aria-label="Meta diária em minutos"
              autoFocus
              className="h-7 w-16 rounded border border-border bg-bg px-2 text-right text-sm tabular-nums select-text focus:border-accent focus:outline-none"
            />
            <span className="text-muted">min</span>
            <button type="submit" aria-label="Salvar meta" className="grid size-7 place-items-center rounded text-success hover:bg-surface-2">
              <Check size={16} />
            </button>
            <button type="button" onClick={() => setEditing(false)} aria-label="Cancelar" className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2">
              <X size={16} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(goalMinutes))
              setEditing(true)
            }}
            title="Alterar a meta diária"
            className="group inline-flex items-center gap-1.5 rounded px-1 tabular-nums text-muted hover:text-text"
          >
            <span>
              <span className={reached ? 'text-success' : ''}>{minutes}</span> / {goalMinutes} min
            </span>
            <Pencil size={12} className="opacity-0 group-hover:opacity-100" />
          </button>
        )}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={minutes}
        aria-valuemax={goalMinutes}
        aria-label="Meta diária"
      >
        <div className={`h-full rounded-full ${reached ? 'bg-success' : 'bg-accent'}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">
        {reached ? 'Meta de hoje cumprida 🎉' : `Faltam ${goalMinutes - minutes} min para a meta`}
        {lessonsCompletedToday > 0 && ` · ${plural(lessonsCompletedToday, 'aula concluída', 'aulas concluídas')} hoje`}
      </p>
    </section>
  )
}
