import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/** Menu suspenso simples: abre no botão, fecha com clique fora ou Esc. */
export function Menu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-surface-2 p-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm disabled:opacity-50 ${
                item.danger ? 'text-red-400 hover:bg-red-500/10' : 'hover:bg-surface'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
