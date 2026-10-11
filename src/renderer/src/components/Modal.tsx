import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Modal sobre o <dialog> nativo: foco preso, Esc fecha e o fundo fica inerte. */
export function Modal({ open, onClose, title, children, footer, wide = false }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

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
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={`m-auto max-h-[85vh] outline-none w-full overflow-hidden rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Fechar">
              <X size={18} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
