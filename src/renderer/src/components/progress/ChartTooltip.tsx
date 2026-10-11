/** Dica flutuante dos gráficos: valor em destaque, rótulo secundário. Texto sempre como texto (nunca HTML). */
export function ChartTooltip({ x, y, value, label }: { x: number; y: number; value: string; label: string }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
      style={{ left: x, top: y - 8 }}
    >
      <span className="block font-semibold text-text tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  )
}

export function minutesLabel(seconds: number): string {
  const min = Math.round(seconds / 60)
  if (min === 0) return seconds > 0 ? '<1 min' : 'sem estudo'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export function dateLabel(key: string, withWeekday = false): string {
  const d = new Date(`${key}T12:00`)
  return d.toLocaleDateString('pt-BR', withWeekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }).replace(/\./g, '')
}
