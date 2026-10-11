import { BookOpen, Plus } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'

export function CoursesPage() {
  // A importação chega no M2; por enquanto o botão fica desabilitado.
  const importButton = (
    <Button disabled title="Disponível no próximo marco">
      <Plus size={16} /> Importar
    </Button>
  )

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader title="Meus Cursos" subtitle="Seus cursos importados" actions={importButton} />
      <EmptyState
        icon={<BookOpen size={22} />}
        title="Sua biblioteca está vazia"
        description="Escolha uma pasta com as aulas do curso. O Tramotak detecta módulos, aulas, legendas e anexos automaticamente."
      />
    </div>
  )
}
