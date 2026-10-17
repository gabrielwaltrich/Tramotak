/** Controles pequenos das Configurações: escolha entre opções e liga/desliga. */
export function Choice<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-40 text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-border p-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1 text-sm ${value === o.value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {children}
    </label>
  )
}
