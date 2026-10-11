/** Duração legível: "45 s", "12 min", "3h05". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  if (sec < 60) return `${sec} s`
  const minutes = Math.floor(sec / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}

export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/** "1 aula" / "3 aulas". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralForm}`
}
