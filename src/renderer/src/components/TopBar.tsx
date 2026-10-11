import { Search } from 'lucide-react'
import { useSearch } from '../lib/searchContext'

const isMac = navigator.platform.toLowerCase().includes('mac')

/**
 * Barra superior com o campo de busca. Ele abre a busca global (a mesma do Ctrl+K); digitar com ele
 * focado já leva a letra para a busca.
 */
export function TopBar() {
  const search = useSearch()
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
      <button
        type="button"
        onClick={() => search.open()}
        onKeyDown={(e) => {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            search.open(e.key)
          }
        }}
        aria-label="Buscar cursos, aulas, anotações, flashcards e questões"
        className="mx-auto flex h-9 w-full max-w-xl items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-accent/50 hover:text-text focus-visible:border-accent"
      >
        <Search size={16} className="shrink-0" />
        <span className="truncate">Buscar cursos, aulas, anotações, flashcards…</span>
        <kbd className="ml-auto shrink-0 rounded border border-border bg-surface-2 px-1.5 text-[10px] tracking-wide">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
    </header>
  )
}
