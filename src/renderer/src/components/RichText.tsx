import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { splitMath } from '@shared/math'

/**
 * Texto com fórmulas LaTeX. O KaTeX gera HTML a partir da fórmula escapando tudo
 * (`trust: false` bloqueia \href, \url etc.); o resto do texto vira nós de texto puro.
 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => splitMath(text), [text])
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span
            key={i}
            className={p.display ? 'my-2 block overflow-x-auto' : ''}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(p.value, { displayMode: p.display, throwOnError: false, trust: false, strict: 'ignore', output: 'html' })
            }}
          />
        )
      )}
    </span>
  )
}
