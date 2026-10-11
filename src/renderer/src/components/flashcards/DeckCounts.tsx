/** Contadores no padrão do Anki: novas (azul), aprendendo (laranja), revisar (verde). */
export function DeckCounts({ newCount, learningCount, reviewCount, highlight }: {
  newCount: number
  learningCount: number
  reviewCount: number
  highlight?: 'new' | 'learning' | 'review'
}) {
  const item = (value: number, label: string, color: string, key: 'new' | 'learning' | 'review') => (
    <span className={`tabular-nums ${value > 0 ? color : 'text-muted'} ${highlight === key ? 'font-semibold underline underline-offset-4' : ''}`} title={label}>
      {value} <span className="text-xs">{label}</span>
    </span>
  )
  return (
    <span className="inline-flex items-center gap-3 text-sm">
      {item(newCount, 'novas', 'text-sky-400', 'new')}
      {item(learningCount, 'aprendendo', 'text-orange-400', 'learning')}
      {item(reviewCount, 'revisar', 'text-success', 'review')}
    </span>
  )
}
