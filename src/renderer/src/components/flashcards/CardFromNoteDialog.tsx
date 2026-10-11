import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note } from '@shared/course'
import { formatClock } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextArea } from '../Field'
import { useToast } from '../Toast'

const NEW_COURSE_DECK = 'course'

/** Transforma uma anotação em flashcard, ligado à aula e ao horário da nota. */
export function CardFromNoteDialog({ note, lessonId, course, onClose }: {
  note: Note | null
  lessonId: number
  course: { id: number; title: string }
  onClose: () => void
}) {
  return (
    <Modal open={note !== null} onClose={onClose} title="Criar flashcard" wide>
      {note && <CardForm key={note.id} note={note} lessonId={lessonId} course={course} onClose={onClose} />}
    </Modal>
  )
}

function CardForm({ note, lessonId, course, onClose }: { note: Note; lessonId: number; course: { id: number; title: string }; onClose: () => void }) {
  const [front, setFront] = useState(note.body)
  const [back, setBack] = useState('')
  const [deckChoice, setDeckChoice] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const decks = useQuery({ queryKey: queryKeys.decks, queryFn: () => window.api.decks.list(), staleTime: 0 })

  const courseDeck = decks.data?.find((d) => d.courseId === course.id)
  const selected = deckChoice ?? (courseDeck ? String(courseDeck.id) : NEW_COURSE_DECK)

  const save = useMutation({
    mutationFn: async () => {
      const deckId = selected === NEW_COURSE_DECK ? await window.api.decks.forCourse(course.id) : Number(selected)
      await window.api.cards.create({ deckId, front, back, lessonId, timestampSec: note.timestampSec })
      return decks.data?.find((d) => d.id === deckId)?.title ?? course.title
    },
    onSuccess: async (deckTitle) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      toast(`Carta criada em “${deckTitle}”`)
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && front.trim()) {
      e.preventDefault()
      save.mutate()
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="card-front">Frente (pergunta)</Label>
        <TextArea id="card-front" value={front} onChange={(e) => setFront(e.target.value)} onKeyDown={keys} />
      </div>
      <div>
        <Label htmlFor="card-back">Verso (resposta)</Label>
        <TextArea id="card-back" value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={keys} placeholder="Opcional" data-autofocus />
      </div>
      <div>
        <Label htmlFor="card-deck">Baralho</Label>
        <select
          id="card-deck"
          value={selected}
          onChange={(e) => setDeckChoice(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text"
        >
          {!courseDeck && <option value={NEW_COURSE_DECK}>Novo baralho: {course.title}</option>}
          {decks.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted">
        A carta fica ligada a esta aula{note.timestampSec !== null ? ` em ${formatClock(note.timestampSec)}` : ''}: no estudo, “Ver na aula” volta a esse ponto.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => save.mutate()} disabled={!front.trim() || save.isPending || decks.isPending}>
          Criar carta
        </Button>
      </div>
    </div>
  )
}
