import { useState } from 'react'
import type { DailyActivity } from '@shared/progress'
import { plural } from '@shared/format'
import { ChartTooltip, dateLabel, minutesLabel } from './ChartTooltip'

const CELL = 12
const GAP = 3
const LEFT = 26
const TOP = 16
const WEEKDAY_LABELS: [number, string][] = [
  [1, 'seg'],
  [3, 'qua'],
  [5, 'sex']
]

/** Nível 0–4 pela fração da meta diária (mesma cor, do claro ao escuro). */
function level(seconds: number, goalMinutes: number): number {
  if (seconds < 60) return 0
  const fraction = seconds / (goalMinutes * 60)
  return fraction < 0.25 ? 1 : fraction < 0.5 ? 2 : fraction < 1 ? 3 : 4
}

const FILL = ['var(--surface-2)', 'color-mix(in oklab, var(--accent) 30%, var(--surface))', 'color-mix(in oklab, var(--accent) 55%, var(--surface))', 'color-mix(in oklab, var(--accent) 80%, var(--surface))', 'var(--accent)']

export function ActivityHeatmap({ daily, goalMinutes }: { daily: DailyActivity[]; goalMinutes: number }) {
  const [hover, setHover] = useState<{ x: number; y: number; day: DailyActivity } | null>(null)
  // Semanas começam no domingo; o primeiro dia é deslocado para a linha do seu dia da semana.
  const pad = new Date(`${daily[0].date}T12:00`).getDay()
  const weeks = Math.ceil((pad + daily.length) / 7)
  const width = LEFT + weeks * (CELL + GAP)
  const height = TOP + 7 * (CELL + GAP)

  const months: { x: number; label: string }[] = []
  daily.forEach((d, i) => {
    if (d.date.endsWith('-01') || i === 0) {
      const week = Math.floor((pad + i) / 7)
      const label = new Date(`${d.date}T12:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      if (!months.length || week - (months.at(-1)!.x - LEFT) / (CELL + GAP) >= 3) months.push({ x: LEFT + week * (CELL + GAP), label })
    }
  })

  const activeDays = daily.filter((d) => d.seconds >= 60).length

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label={`Mapa de atividade: ${plural(activeDays, 'dia')} com estudo no último ano`} className="block">
          {months.map((m) => (
            <text key={`${m.x}-${m.label}`} x={m.x} y={10} className="fill-[var(--text-muted)] text-[10px]">
              {m.label}
            </text>
          ))}
          {WEEKDAY_LABELS.map(([row, label]) => (
            <text key={label} x={0} y={TOP + row * (CELL + GAP) + CELL - 2} className="fill-[var(--text-muted)] text-[10px]">
              {label}
            </text>
          ))}
          {daily.map((d, i) => {
            const week = Math.floor((pad + i) / 7)
            const row = (pad + i) % 7
            const x = LEFT + week * (CELL + GAP)
            const y = TOP + row * (CELL + GAP)
            return (
              <rect
                key={d.date}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={3}
                fill={FILL[level(d.seconds, goalMinutes)]}
                stroke={hover?.day.date === d.date ? 'var(--text)' : 'none'}
                strokeWidth={1.5}
                onMouseEnter={() => setHover({ x: x + CELL / 2, y, day: d })}
              />
            )
          })}
        </svg>
      </div>
      {hover && <ChartTooltip x={hover.x} y={hover.y} value={minutesLabel(hover.day.seconds)} label={dateLabel(hover.day.date, true)} />}
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{plural(activeDays, 'dia')} com estudo no último ano</span>
        <span className="flex items-center gap-1">
          menos
          {FILL.map((fill, i) => (
            <span key={i} className="inline-block size-3 rounded-[3px]" style={{ background: fill }} />
          ))}
          meta batida
        </span>
      </div>
    </div>
  )
}
