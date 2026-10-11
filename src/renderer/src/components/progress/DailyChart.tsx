import { useState } from 'react'
import type { DailyActivity } from '@shared/progress'
import { ChartTooltip, dateLabel, minutesLabel } from './ChartTooltip'

const HEIGHT = 180
const PAD = { top: 12, right: 8, bottom: 22, left: 34 }
const MAX_BAR = 24
const RADIUS = 4

/** Passo "redondo" para o eixo em minutos: 15, 30, 60, 120... */
function niceStep(max: number): number {
  const target = max / 4
  return [5, 10, 15, 30, 60, 120, 180, 240].find((s) => s >= target) ?? 240
}

/** Coluna com cantos arredondados só no topo (base reta, presa no eixo). */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(RADIUS, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

export function DailyChart({ days, goalMinutes, width }: { days: DailyActivity[]; goalMinutes: number; width: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const minutes = days.map((d) => d.seconds / 60)
  const step = niceStep(Math.max(goalMinutes, ...minutes))
  const top = Math.ceil(Math.max(goalMinutes, ...minutes) / step) * step
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const slot = plotW / days.length
  const barW = Math.min(MAX_BAR, Math.max(2, slot - 2))
  const y = (m: number) => PAD.top + plotH - (m / top) * plotH
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const total = minutes.reduce((a, b) => a + b, 0)

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Minutos estudados por dia nos últimos ${days.length} dias; total ${minutesLabel(total * 60)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--text-muted)] text-[10px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          const h = PAD.top + plotH - y(minutes[i])
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {/* Área de toque maior que a coluna: o slot inteiro. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              <path d={columnPath(x, y(minutes[i]), barW, h)} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          )
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(goalMinutes)} y2={y(goalMinutes)} stroke="var(--text-muted)" strokeWidth={1} />
        <text x={width - PAD.right} y={y(goalMinutes) - 4} textAnchor="end" className="fill-[var(--text-muted)] text-[10px]">
          meta {goalMinutes} min
        </text>
        {days.map((d, i) =>
          i % 7 === days.length % 7 || i === days.length - 1 ? (
            <text key={d.date} x={PAD.left + i * slot + slot / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-[var(--text-muted)] text-[10px]">
              {i === days.length - 1 ? 'hoje' : dateLabel(d.date)}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <ChartTooltip
          x={PAD.left + hover * slot + slot / 2}
          y={y(minutes[hover])}
          value={minutesLabel(days[hover].seconds)}
          label={dateLabel(days[hover].date, true)}
        />
      )}
      <table className="sr-only">
        <caption>Minutos estudados por dia</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{dateLabel(d.date, true)}</th>
              <td>{minutesLabel(d.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
