import { useNavigate } from 'react-router'
import { FolderPlus } from 'lucide-react'
import { formatLongDate, greeting } from '@shared/greeting'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'

export function HomePage() {
  const navigate = useNavigate()
  const now = new Date()

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader title={`${greeting(now.getHours())} 👋`} subtitle={formatLongDate(now)} />

      <section className="mb-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Hoje até agora</span>
          <span className="tabular-nums text-muted">0 / 60 min</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-0 rounded-full bg-accent" />
        </div>
      </section>

      <EmptyState
        icon={<FolderPlus size={22} />}
        title="Nenhum curso ainda"
        description="Importe a pasta de um curso que já está no seu computador para começar a estudar."
        action={<Button onClick={() => navigate('/courses')}>Importar seu primeiro curso</Button>}
      />
    </div>
  )
}
