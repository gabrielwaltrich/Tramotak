import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarRange, Loader2, Trash2 } from 'lucide-react'
import { plural } from '@shared/format'
import { dayKey } from '@shared/streak'
import {
  DEFAULT_PLAN,
  SPEEDS,
  WEEKDAY_LABELS,
  addDaysKey,
  formatDateKey,
  formatMinutes,
  type PlanSettings,
  type StudyPlanView
} from '@shared/studyPlan'
import { errorMessage, queryKeys } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, Segmented, TextInput } from '../Field'
import { useToast } from '../Toast'
import { relativeDay } from './TaskMeta'

const QUICK_TARGETS = [
  { label: '1 mês', days: 30 },
  { label: '2 meses', days: 61 },
  { label: '3 meses', days: 91 },
  { label: '6 meses', days: 182 }
]
const QUICK_MINUTES = [15, 30, 45, 60, 90]

/** Criar ou editar o plano de estudos de um curso, com prévia do resultado antes de salvar. */
export function StudyPlanDialog({ courseId, courseTitle, plan, onClose }: {
  courseId: number
  courseTitle: string
  plan: StudyPlanView | null
  onClose: () => void
}) {
  const today = dayKey(new Date())
  const queryClient = useQueryClient()
  const toast = useToast()
  const appSettings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get() })
  const [draft, setDraft] = useState<PlanSettings>(() => plan?.settings ?? { ...DEFAULT_PLAN, targetDate: addDaysKey(today, 61) })
  const [start, setStart] = useState(today)
  const [touchedMinutes, setTouchedMinutes] = useState(plan !== null)

  // Plano novo: o ritmo começa na meta diária das Configurações, até a pessoa mudar.
  const goal = appSettings.data?.dailyGoalMinutes
  const settings: PlanSettings = !touchedMinutes && goal ? { ...draft, minutesPerDay: Math.max(5, goal) } : draft

  const set = (patch: Partial<PlanSettings>) => setDraft({ ...settings, ...patch })
  const preview = useQuery({
    queryKey: ['planPreview', courseId, settings, start],
    queryFn: () => window.api.plans.preview(courseId, settings, start),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.plans }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
    ])
  }
  const save = useMutation({
    mutationFn: () => window.api.plans.save(courseId, settings, start),
    onSuccess: async (view) => {
      await refresh()
      toast(view.status.endDate ? `Plano salvo: termina em ${formatDateKey(view.status.endDate)}` : 'Plano salvo')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.plans.delete(courseId),
    onSuccess: async () => {
      await refresh()
      toast('Plano apagado. Os dias já concluídos continuam no Planner.')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const toggleDay = (day: number) =>
    set({ weekdays: settings.weekdays.includes(day) ? settings.weekdays.filter((d) => d !== day) : [...settings.weekdays, day].sort() })

  const data = preview.data
  const result = data?.result
  const previewError = preview.isError ? errorMessage(preview.error) : null

  return (
    <Modal
      open
      onClose={onClose}
      title={`Plano de estudos · ${courseTitle}`}
      wide
      footer={
        <>
          {plan && (
            <Button variant="ghost" className="mr-auto" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 size={16} /> Apagar plano
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || Boolean(previewError) || !result?.days.length}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarRange size={16} />}
            {plan ? 'Salvar e refazer o plano' : 'Criar plano'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="space-y-5">
          <div>
            <Label>Como planejar</Label>
            <Segmented
              label="Como planejar"
              value={settings.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: 'date', label: 'Terminar até uma data' },
                { value: 'pace', label: 'Minutos por dia' }
              ]}
            />
          </div>

          {settings.mode === 'date' ? (
            <div>
              <Label htmlFor="plan-target">Terminar até</Label>
              <div className="flex flex-wrap items-center gap-2">
                <TextInput
                  id="plan-target"
                  type="date"
                  min={today}
                  value={settings.targetDate ?? ''}
                  onChange={(e) => set({ targetDate: e.target.value || null })}
                  className="w-44"
                />
                {QUICK_TARGETS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => set({ targetDate: addDaysKey(start, q.days) })}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-text"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="plan-minutes">Minutos por dia de estudo</Label>
              <div className="flex flex-wrap items-center gap-2">
                <TextInput
                  id="plan-minutes"
                  type="number"
                  min={5}
                  max={720}
                  value={settings.minutesPerDay}
                  onChange={(e) => {
                    setTouchedMinutes(true)
                    set({ minutesPerDay: Number(e.target.value) || 0 })
                  }}
                  className="w-24"
                />
                {QUICK_MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setTouchedMinutes(true)
                      set({ minutesPerDay: m })
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs ${settings.minutesPerDay === m ? 'border-accent text-accent' : 'border-border text-muted hover:text-text'}`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Dias de estudo</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de estudo">
              {WEEKDAY_LABELS.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={settings.weekdays.includes(day)}
                  onClick={() => toggleDay(day)}
                  className={`w-12 rounded-md border py-1.5 text-sm ${
                    settings.weekdays.includes(day) ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div>
              <Label>Velocidade dos vídeos</Label>
              <Segmented
                label="Velocidade dos vídeos"
                value={String(settings.speed)}
                onChange={(v) => set({ speed: Number(v) })}
                options={SPEEDS.map((s) => ({ value: String(s), label: `${s.toLocaleString('pt-BR')}×` }))}
              />
            </div>
            <div>
              <Label htmlFor="plan-start">Começar em</Label>
              <TextInput id="plan-start" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value || today)} className="w-44" />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoReplan}
              onChange={(e) => set({ autoReplan: e.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Replanejar sozinho quando atrasar
              <span className="block text-xs text-muted">
                Aulas de dias que passaram sem estudo são redistribuídas a partir de hoje
                {settings.mode === 'date' ? ', mantendo a data-alvo.' : ', no mesmo ritmo.'}
              </span>
            </span>
          </label>
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-4 text-sm" aria-live="polite">
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Prévia</p>
          {previewError ? (
            <p className="text-warning">{previewError}</p>
          ) : !data || !result ? (
            <Loader2 className="mx-auto animate-spin text-muted" />
          ) : data.remainingLessons === 0 ? (
            <p>Todas as aulas deste curso já foram concluídas.</p>
          ) : (
            <>
              <dl className="space-y-1.5">
                <Row label="Aulas que faltam" value={`${data.remainingLessons.toLocaleString('pt-BR')} · ${formatMinutes(result.totalMinutes)}`} />
                <Row label="Por dia de estudo" value={`~${formatMinutes(result.minutesPerDay)}`} />
                <Row label="Dias com aulas" value={String(result.days.length)} />
                {result.endDate && <Row label="Termina em" value={formatDateKey(result.endDate, today)} strong />}
              </dl>
              {result.warning && (
                <p className="flex gap-1.5 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {result.warning}
                </p>
              )}
              {data.otherPlansMinutes > 0 && (
                <p className="text-xs text-muted">Outros planos já pedem ~{formatMinutes(data.otherPlansMinutes)} por dia de estudo.</p>
              )}
              {data.estimatedLessons > 0 && (
                <p className="text-xs text-muted">
                  {plural(data.estimatedLessons, 'vídeo ainda sem duração medida', 'vídeos ainda sem duração medida')}: estimados pela duração
                  típica do curso.
                </p>
              )}
              <ol className="space-y-1 border-t border-border pt-3 text-xs">
                {result.days.slice(0, 5).map((d) => (
                  <li key={d.date} className="flex justify-between gap-2">
                    <span className="capitalize">{relativeDay(d.date, today)}</span>
                    <span className="text-muted">
                      {plural(d.lessonIds.length, 'aula')} · {formatMinutes(d.minutes)}
                    </span>
                  </li>
                ))}
                {result.days.length > 5 && <li className="text-muted">e mais {plural(result.days.length - 5, 'dia')}…</li>}
              </ol>
            </>
          )}
        </aside>
      </div>
    </Modal>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? 'font-semibold text-accent' : ''}>{value}</dd>
    </div>
  )
}
