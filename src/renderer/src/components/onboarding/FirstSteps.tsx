import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import type { FirstStepId } from '@shared/onboarding'
import { errorMessage, queryKeys } from '../../lib/api'
import { useToast } from '../Toast'

/** Lista "Primeiros passos" do Início: some quando tudo foi feito ou quando a pessoa dispensa. */
export function FirstSteps() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const onboarding = useQuery({ queryKey: queryKeys.onboarding, queryFn: () => window.api.onboarding.get(), staleTime: 0 })
  const dismiss = useMutation({
    mutationFn: () => window.api.onboarding.dismiss(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.onboarding }),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const steps = onboarding.data?.steps
  if (!steps || onboarding.data?.showWelcome) return null

  const sample = onboarding.data?.sample
  const studyPlace = sample ? `/courses/${sample.courseId}` : '/courses'
  const target: Record<FirstStepId, string> = {
    course: '/courses?import=1',
    watch: studyPlace,
    note: studyPlace,
    cards: '/flashcards',
    exam: '/questions',
    ai: '/settings#ai'
  }
  const done = steps.filter((s) => s.done).length

  return (
    <section aria-label="Primeiros passos" className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted uppercase">
          <ListChecks size={14} /> Primeiros passos · {done} de {steps.length}
        </p>
        <button type="button" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} className="text-sm text-muted hover:text-text">
          Dispensar
        </button>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => navigate(target[s.id])}
              disabled={s.done}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-bg/60 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {s.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-label="Feito" /> : <Circle size={18} className="mt-0.5 shrink-0 text-muted" aria-label="A fazer" />}
              <span className="min-w-0">
                <span className={`block text-sm ${s.done ? 'text-muted line-through' : ''}`}>{s.label}</span>
                {!s.done && <span className="block text-xs text-muted">{s.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
