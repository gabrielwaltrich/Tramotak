import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../../lib/markdown'

/** Mostra o Markdown renderizado; clique (ou foco) troca para edição. */
export function TextBlock({ text, editing, onEdit, onChange, onDone, readOnly }: {
  text: string
  editing: boolean
  onEdit: () => void
  onChange: (text: string) => void
  onDone: () => void
  readOnly: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const html = useMemo(() => renderMarkdown(text), [text])

  // Cresce com o conteúdo, sem barra de rolagem própria.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text, editing])

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  if (editing && !readOnly) {
    return (
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), e.stopPropagation())}
        placeholder="Escreva em Markdown: # título, **negrito**, - lista, $fórmula$…"
        aria-label="Texto do bloco"
        className="block w-full resize-none overflow-hidden rounded-md border border-accent/50 bg-bg px-3 py-2 font-mono text-sm leading-relaxed text-text outline-none select-text"
      />
    )
  }

  if (!text.trim()) {
    return readOnly ? null : (
      <button type="button" onClick={onEdit} className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-2">
        Clique para escrever…
      </button>
    )
  }

  return (
    <div
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        if (!readOnly) onEdit()
      }}
      onKeyDown={(e) => !readOnly && e.key === 'Enter' && (e.preventDefault(), onEdit())}
      className={`prose-tk rounded-md px-3 py-2 select-text ${readOnly ? '' : 'cursor-text hover:bg-surface-2/60'}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
