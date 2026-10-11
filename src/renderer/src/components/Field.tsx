import type { ComponentProps, ReactNode } from 'react'

const INPUT =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none select-text'

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
      {children}
    </label>
  )
}

export function TextInput(props: ComponentProps<'input'>) {
  return <input {...props} className={`${INPUT} h-9 ${props.className ?? ''}`} />
}

export function TextArea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`${INPUT} min-h-24 resize-y ${props.className ?? ''}`} />
}

/** Grupo de opções exclusivas em formato de "pílulas". */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            value === o.value
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
