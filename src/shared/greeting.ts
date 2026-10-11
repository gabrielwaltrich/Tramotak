/** Saudação conforme a hora local: 5–11h bom dia, 12–17h boa tarde, resto boa noite. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function formatLongDate(date: Date, locale = 'pt-BR'): string {
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
}
