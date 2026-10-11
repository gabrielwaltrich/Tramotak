import type { ReactNode } from 'react'

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">{icon}</div>
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
