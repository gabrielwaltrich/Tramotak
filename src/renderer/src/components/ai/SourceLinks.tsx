import { Globe } from 'lucide-react'
import type { AiWebSource } from '@shared/ai'

/** Páginas consultadas na internet pela IA (abrem no navegador do sistema). */
export function SourceLinks({ sources, className = '' }: { sources: AiWebSource[] | undefined; className?: string }) {
  if (!sources?.length) return null
  return (
    <div className={`text-xs ${className}`}>
      <p className="mb-1 flex items-center gap-1 text-muted">
        <Globe size={12} /> Fontes consultadas na internet
      </p>
      <ol className="list-decimal space-y-0.5 pl-5">
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline" title={s.url}>
              {s.title || new URL(s.url).hostname}
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
