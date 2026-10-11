import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CourseSummary } from '@shared/course'
import { errorMessage, queryKeys } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Label, TextArea, TextInput } from './Field'
import { useToast } from './Toast'

export function EditCourseDialog({ course, onClose }: { course: CourseSummary | null; onClose: () => void }) {
  return (
    <Modal open={course !== null} onClose={onClose} title="Editar curso">
      {course && <EditForm key={course.id} course={course} onClose={onClose} />}
    </Modal>
  )
}

function EditForm({ course, onClose }: { course: CourseSummary; onClose: () => void }) {
  const [title, setTitle] = useState(course.title)
  const [description, setDescription] = useState(course.description)
  const queryClient = useQueryClient()
  const toast = useToast()

  const save = useMutation({
    mutationFn: () => window.api.courses.update(course.id, { title, description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast('Curso atualizado')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div>
        <Label htmlFor="edit-title">Título</Label>
        <TextInput id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
      </div>
      <div>
        <Label htmlFor="edit-description">Descrição</Label>
        <TextArea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <p className="truncate text-xs text-muted select-text" title={course.rootPath}>
        Pasta: {course.rootPath}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!title.trim() || save.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  )
}
