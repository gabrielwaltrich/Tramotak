import { useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, Flame, Loader2, Search } from 'lucide-react'
import type { HistoryFilter, ProgressData } from '@shared/progress'
import { formatClock, percent, plural } from '@shared/format'
import { queryKeys } from '../lib/api'
import { useWidth } from '../lib/useWidth'
import { PageHeader } from '../components/PageHeader'
import { TextInput } from '../components/Field'
import { ActivityHeatmap } from '../components/progress/ActivityHeatmap'
import { DailyChart } from '../components/progress/DailyChart'
import { minutesLabel } from '../components/progress/ChartTooltip'

const TREND_DAYS = 30

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-medium">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Trend({ data }: { data: ProgressData }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const days = data.daily.slice(-TREND_DAYS)
  const total = days.reduce((n, d) => n + d.seconds, 0)
  const hit = days.filter((d) => d.seconds >= data.goalMinutes * 60).length
  return (
    <Card title={`Últimos ${TREND_DAYS} dias`} subtitle={`${minutesLabel(total)} no total · meta batida em ${plural(hit, 'dia')}`}>
      <div ref={ref}>{width > 0 && <DailyChart days={days} goalMinutes={data.goalMinutes} width={width} />}</div>
    </Card>
  )
}

function History({ courses }: { courses: ProgressData['courses'] }) {
  const [filter, setFilter] = useState<HistoryFilter>({ courseId: null, text: '', from: '', to: '' })
  const history = useQuery({
    queryKey: queryKeys.history(filter),
    queryFn: () => window.api.stats.history(filter),
    placeholderData: keepPreviousData,
    staleTime: 0
  })
  const set = (patch: Partial<HistoryFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const select = 'h-9 rounded-md border border-border bg-bg px-3 text-sm text-text'

  return (
    <Card title="Histórico" subtitle="Aulas assistidas, da mais recente para a mais antiga">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <TextInput value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Buscar aula, módulo ou curso…" className="pl-9" aria-label="Filtrar histórico" />
        </div>
        <select value={filter.courseId ?? ''} onChange={(e) => set({ courseId: e.target.value ? Number(e.target.value) : null })} aria-label="Curso" className={select}>
          <option value="">Todos os cursos</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          de <TextInput type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value })} className="w-40" aria-label="Data inicial" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          até <TextInput type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value })} className="w-40" aria-label="Data final" />
        </label>
      </div>
      {history.data && history.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nenhuma aula encontrada.</p>
      ) : (
        <ul className="divide-y divide-border">
          {history.data?.map((h) => (
            <li key={h.lessonId}>
              <Link to={`/lesson/${h.lessonId}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2">
                {h.completed ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{h.title}</p>
                  <p className="truncate text-xs text-muted">{[h.courseTitle, h.moduleTitle].filter(Boolean).join(' · ')}</p>
                </div>
                {h.durationSec !== null && !h.completed && (
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {formatClock(h.positionSec)} / {formatClock(h.durationSec)}
                  </span>
                )}
                <span className="w-28 shrink-0 text-right text-xs text-muted">
                  {new Date(h.lastWatchedAt * 1000).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function ProgressPage() {
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: () => window.api.stats.get(), staleTime: 0 })

  if (stats.isPending) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (stats.isError) return <p className="p-8 text-sm text-red-400">Não foi possível carregar o progresso.</p>

  const d = stats.data
  const hours = d.totals.studySeconds / 3600
  const fc = d.flashcards

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-8">
      <PageHeader title="Progresso" subtitle="Tudo o que você já estudou, calculado a partir do seu uso" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Tempo estudado"
          value={hours >= 1 ? `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h` : minutesLabel(d.totals.studySeconds)}
          detail="aulas e flashcards"
        />
        <Tile label="Aulas concluídas" value={d.totals.lessonsCompleted.toLocaleString('pt-BR')} detail={`${plural(d.totals.coursesCompleted, 'curso concluído', 'cursos concluídos')}`} />
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm text-muted">Sequência</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            <Flame size={20} className={d.streak.todayDone ? 'text-orange-400' : 'text-muted'} fill={d.streak.todayDone ? 'currentColor' : 'none'} />
            {plural(d.streak.current, 'dia')}
          </p>
          <p className="mt-0.5 text-xs text-muted">recorde: {plural(d.streak.best, 'dia')}</p>
        </div>
        <Tile
          label="Flashcards (30 dias)"
          value={plural(fc.reviews30d, 'revisão', 'revisões')}
          detail={fc.retention30d === null ? 'sem revisões de cartas maduras ainda' : `${Math.round(fc.retention30d * 100)}% de acerto nas revisões`}
        />
      </div>

      <Card title="Atividade" subtitle={`Cada quadrado é um dia; a cor mostra o quanto da meta de ${d.goalMinutes} min você estudou`}>
        <ActivityHeatmap daily={d.daily} goalMinutes={d.goalMinutes} />
      </Card>

      <Trend data={d} />

      <div className="grid gap-5 md:grid-cols-[3fr_2fr]">
        <Card title="Progresso por curso">
          {d.courses.length === 0 ? (
            <p className="text-sm text-muted">Nenhum curso importado.</p>
          ) : (
            <ul className="space-y-3">
              {d.courses.map((c) => {
                const p = percent(c.completed, c.total)
                return (
                  <li key={c.id}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <Link to={`/courses/${c.id}`} className="truncate hover:text-accent">
                        {c.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {c.completed}/{c.total} · {p}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-accent-soft" role="progressbar" aria-valuenow={p} aria-valuemax={100} aria-label={c.title}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <Card title="Flashcards">
          <dl className="grid grid-cols-3 gap-3 text-center">
            {(
              [
                ['Novas', fc.cards.new, 'text-sky-400'],
                ['Aprendendo', fc.cards.learning, 'text-orange-400'],
                ['Revisão', fc.cards.review, 'text-success']
              ] as const
            ).map(([label, value, color]) => (
              <div key={label} className="rounded-lg bg-surface-2 p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className={`mt-1 text-xl font-semibold tabular-nums ${value > 0 ? color : 'text-muted'}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            {plural(d.totals.reviews, 'revisão feita', 'revisões feitas')} no total · {plural(d.totals.notes, 'anotação', 'anotações')} nas aulas
          </p>
        </Card>
      </div>

      <History courses={d.courses} />
    </div>
  )
}
