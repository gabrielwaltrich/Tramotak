import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarRange, CheckCircle2, Loader2, Pencil, RefreshCw } from 'lucide-react'
import { plural } from '@shared/format'
import { dayKey } from '@shared/streak'
import { WEEKDAY_LABELS, formatDateKey, formatMinutes, type StudyPlanView } from '@shared/studyPlan'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { useToast } from '../Toast'
import { PlanLessons } from './PlanLessons'
import { relativeDay } from './TaskMeta'

/** "todos os dias", "seg a sex", "dom a sex", "seg, qua, sex". */
export function weekdaysLabel(days: number[]): string {
  if (days.length === 7) return 'todos os dias'
  const name = (d: number) => WEEKDAY_LABELS[d].toLowerCase()
  const sorted = [...days].sort()
  const consecutive = sorted.length >= 3 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  return consecutive ? `${name(sorted[0])} a ${name(sorted[sorted.length - 1])}` : sorted.map(name).join(', ')
}

export function useReplan(courseId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => window.api.plans.replan(courseId),
    onSuccess: async (view) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plans }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      ])
      toast(view.status.endDate ? `Replanejado: termina em ${formatDateKey(view.status.endDate)}` : 'Replanejado')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
}

/** Resumo do plano de estudos do curso: hoje, término, atrasos e a previsão pelo ritmo real. */
export function PlanCard({ plan, onEdit, compact = false }: { plan: StudyPlanView; onEdit?: () => void; compact?: boolean }) {
  const today = dayKey(new Date())
  const replan = useReplan(plan.courseId)
  const { status, settings } = plan
  const finished = status.remainingLessons === 0
  const todayDay = status.upcoming.find((d) => d.date === today)
  const next = status.upcoming.find((d) => d.date > today && !d.done)
  const needsReplan = status.behindLessons > 0 || status.unplannedLessons > 0

  const target =
    settings.mode === 'date' && settings.targetDate
      ? `meta: ${formatDateKey(settings.targetDate, today)}`
      : `${settings.minutesPerDay} min por dia`
  const late = settings.mode === 'date' && settings.targetDate && status.endDate && status.endDate > settings.targetDate

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label={`Plano de estudos de ${plan.courseTitle}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted uppercase">
            <CalendarRange size={14} /> {compact ? <Link to={`/courses/${plan.courseId}`} className="truncate normal-case hover:text-accent">{plan.courseTitle}</Link> : 'Plano de estudos'}
          </p>
          {finished ? (
            <p className="mt-1 flex items-center gap-1.5 font-medium text-success">
              <CheckCircle2 size={16} /> Curso concluído
            </p>
          ) : (
            <p className="mt-1 font-medium">
              {status.endDate ? `Termina em ${formatDateKey(status.endDate, today)}` : 'Sem dias planejados'}
              <span className="ml-2 text-sm font-normal text-muted">
                {target} · {weekdaysLabel(settings.weekdays)}
                {status.averageMinutes > 0 && ` · ~${formatMinutes(status.averageMinutes)} por dia`}
              </span>
            </p>
          )}
        </div>
        {!finished && (
          <div className="flex gap-2">
            {onEdit && (
              <Button variant="ghost" onClick={onEdit}>
                <Pencil size={14} /> Editar
              </Button>
            )}
            <Button variant={needsReplan ? 'primary' : 'ghost'} onClick={() => replan.mutate()} disabled={replan.isPending} title="Redistribuir as aulas que faltam a partir de hoje">
              {replan.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Replanejar
            </Button>
          </div>
        )}
      </div>

      {!finished && (
        <>
          {(needsReplan || late) && (
            <ul className="mt-3 space-y-1 text-sm text-warning">
              {status.behindLessons > 0 && (
                <li className="flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {plural(status.behindLessons, 'aula atrasada', 'aulas atrasadas')} de dias que passaram
                </li>
              )}
              {status.unplannedLessons > 0 && (
                <li className="flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {plural(status.unplannedLessons, 'aula ficou', 'aulas ficaram')} fora do plano
                </li>
              )}
              {late && !needsReplan && (
                <li className="flex items-center gap-1.5">
                  <AlertTriangle size={14} /> Passa da data-alvo: edite o plano para escolher outra data ou mais tempo por dia
                </li>
              )}
            </ul>
          )}

          <div className={`mt-4 grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-muted">
                {todayDay ? `Hoje · ${formatMinutes(todayDay.minutes)}` : next ? `Hoje é folga · próximo: ${relativeDay(next.date, today)}` : 'Nada planejado para os próximos dias'}
              </p>
              {todayDay ? (
                todayDay.done ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 size={14} /> Dia concluído
                  </p>
                ) : (
                  <PlanLessons lessons={todayDay.lessons} limit={compact ? 3 : 8} />
                )
              ) : (
                next && <PlanLessons lessons={next.lessons} limit={compact ? 3 : 8} />
              )}
            </div>
            {!compact && (
              <div className="text-sm">
                <p className="mb-1.5 text-xs font-medium text-muted">No seu ritmo</p>
                <p>
                  Faltam {plural(status.remainingLessons, 'aula')} ({formatMinutes(status.remainingMinutes)}).
                </p>
                <p className="mt-1 text-muted">
                  {status.forecastDate
                    ? `Nos últimos 14 dias você concluiu ~${formatMinutes(status.recentMinutesPerDay)} por dia deste curso; nesse ritmo, termina em ${formatDateKey(status.forecastDate, today)}.`
                    : 'Nenhuma aula deste curso concluída nos últimos 14 dias.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
