import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { marked } from 'marked'
import { errorMessage } from '../../lib/api'

/** CSS do documento dentro do iframe, seguindo o tema atual. */
function documentCss(): string {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return `
    :root { color-scheme: ${document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}; }
    body { margin: 0; padding: 28px 32px; background: ${v('--surface')}; color: ${v('--text')};
           font: 15px/1.7 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    a { color: ${v('--accent')}; }
    pre, code { background: ${v('--surface-2')}; border-radius: 6px; font-size: 13px; }
    pre { padding: 12px 14px; overflow: auto; } code { padding: 1px 5px; } pre code { padding: 0; }
    img, video { max-width: 100%; }
    table { border-collapse: collapse; } td, th { border: 1px solid ${v('--border')}; padding: 4px 8px; }
    blockquote { margin: 0; padding-left: 14px; border-left: 3px solid ${v('--border')}; color: ${v('--text-muted')}; }
    .plain { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 13px; }
  `
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Aula de texto (.md, .html, .txt). O conteúdo roda num iframe com sandbox vazio:
 * sem scripts, sem acesso ao app, sem navegação.
 */
export function TextLesson({ lessonId }: { lessonId: number }) {
  const text = useQuery({ queryKey: ['lesson-text', lessonId], queryFn: () => window.api.lessons.text(lessonId) })

  if (text.isPending) {
    return (
      <div className="grid aspect-video place-items-center rounded-xl border border-border bg-surface text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (text.isError) return <p className="rounded-xl border border-border bg-surface p-6 text-sm text-red-400">{errorMessage(text.error)}</p>

  const { format, content } = text.data
  const body =
    format === 'markdown' ? (marked.parse(content, { async: false }) as string)
    : format === 'html' ? content
    : `<div class="plain">${escapeHtml(content)}</div>`

  return (
    <iframe
      title="Conteúdo da aula"
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${documentCss()}</style></head><body>${body}</body></html>`}
      className="h-[70vh] w-full rounded-xl border border-border bg-surface"
    />
  )
}
