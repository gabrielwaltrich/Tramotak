import { HL_END, HL_START } from '@shared/course'

/** Mostra os trechos marcados pela busca com destaque, sem usar HTML vindo do banco. */
export function Highlight({ text }: { text: string }) {
  const parts: { text: string; marked: boolean }[] = []
  let rest = text
  while (rest) {
    const start = rest.indexOf(HL_START)
    if (start < 0) {
      parts.push({ text: rest, marked: false })
      break
    }
    const end = rest.indexOf(HL_END, start)
    if (start > 0) parts.push({ text: rest.slice(0, start), marked: false })
    parts.push({ text: rest.slice(start + 1, end < 0 ? undefined : end), marked: true })
    rest = end < 0 ? '' : rest.slice(end + 1)
  }
  return (
    <>
      {parts.map((p, i) =>
        p.marked ? (
          <mark key={i} className="rounded-sm bg-accent/25 px-0.5 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}
