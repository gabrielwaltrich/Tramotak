import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Modal sobre o <dialog> nativo: foco preso, Esc fecha e o fundo fica inerte. */
export function Modal({ open, onClose, title, children, footer, wide = false, full = false, headerExtra }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Quase a tela toda (ex.: leitor de PDF). */
  full?: boolean
  /** Ações no cabeçalho, antes do "fechar". */
  headerExtra?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal foca o primeiro botão (o "X"); preferimos o alvo marcado ou o próprio diálogo.
      const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog
      target.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      // O evento "close" chega depois de dialog.close(); se o diálogo já foi reaberto (ex.: Esc e Ctrl+K
      // em seguida), é um evento atrasado e não pode fechá-lo de novo.
      onClose={() => {
        if (!ref.current?.open) onClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={`m-auto outline-none w-full overflow-hidden rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 ${
        full ? 'h-[94vh] max-h-[94vh] max-w-[min(72rem,96vw)]' : wide ? 'max-h-[85vh] max-w-2xl' : 'max-h-[85vh] max-w-md'
      }`}
    >
      {open && (
        <div className={`flex flex-col ${full ? 'h-full' : 'max-h-[85vh]'}`}>
          <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 id={titleId} className="min-w-0 truncate font-semibold">{title}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {headerExtra}
              <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
          </header>
          <div className={`min-h-0 flex-1 ${full ? 'p-3' : 'overflow-y-auto px-5 py-4'}`}>{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
