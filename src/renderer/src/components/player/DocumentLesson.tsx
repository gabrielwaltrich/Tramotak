import { ExternalLink, FileText, FolderOpen } from 'lucide-react'
import type { LessonView } from '@shared/course'
import { Button } from '../Button'

export function DocumentLesson({ lesson }: { lesson: LessonView }) {
  const name = lesson.relPath.split('/').pop()
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface p-6 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
        <FileText size={26} />
      </div>
      <div>
        <p className="font-medium">{name}</p>
        <p className="mt-1 text-sm text-muted">Este material abre no aplicativo padrão do seu sistema.</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => window.api.files.openLesson(lesson.id)}>
          <ExternalLink size={16} /> Abrir arquivo
        </Button>
        <Button variant="ghost" onClick={() => window.api.files.showLesson(lesson.id)}>
          <FolderOpen size={16} /> Mostrar na pasta
        </Button>
      </div>
    </div>
  )
}
