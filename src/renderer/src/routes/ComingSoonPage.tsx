import { Hourglass } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'

export function ComingSoonPage() {
  return (
    <div className="mx-auto max-w-5xl p-8">
      <EmptyState icon={<Hourglass size={22} />} title="Em breve" description="Esta área ainda está em construção." />
    </div>
  )
}
