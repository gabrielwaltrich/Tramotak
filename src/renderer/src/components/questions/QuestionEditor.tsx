import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { QUESTION_TYPE_LABEL, type Question, type QuestionInput, type QuestionKey, type QuestionType } from '@shared/questions'
import { errorMessage } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextArea, TextInput } from '../Field'
import { RichText } from '../RichText'
import { useToast } from '../Toast'

export type EditorState = { mode: 'create' } | { mode: 'edit'; question: Question } | null

const SELECT = 'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text'
let nextOption = 1
const newOptionId = () => `n${Date.now().toString(36)}${nextOption++}`

function emptyKey(type: QuestionType, optionIds: string[]): QuestionKey {
  switch (type) {
    case 'single':
      return { type, correct: optionIds[0] ?? '' }
    case 'multiple':
      return { type, correct: [] }
    case 'truefalse':
      return { type, correct: true }
    case 'short':
      return { type, accepted: [] }
    case 'essay':
      return { type, reference: '' }
  }
}

export function QuestionEditor({ state, bankId, topics, onClose, onSaved }: {
  state: EditorState
  bankId: number
  topics: string[]
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Modal open={state !== null} onClose={onClose} title={state?.mode === 'edit' ? 'Editar questão' : 'Nova questão'} wide>
      {state && (
        <EditorForm
          key={state.mode === 'edit' ? state.question.id : 'nova'}
          initial={state.mode === 'edit' ? state.question : null}
          bankId={bankId}
          topics={topics}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  )
}

function EditorForm({ initial, bankId, topics, onClose, onSaved }: {
  initial: Question | null
  bankId: number
  topics: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const startOptions = initial?.options.length ? initial.options : [{ id: newOptionId(), text: '' }, { id: newOptionId(), text: '' }]
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'single')
  const [statement, setStatement] = useState(initial?.statement ?? '')
  const [options, setOptions] = useState(startOptions)
  const [key, setKey] = useState<QuestionKey>(initial?.key ?? emptyKey('single', startOptions.map((o) => o.id)))
  const [accepted, setAccepted] = useState(initial?.key.type === 'short' ? initial.key.accepted.join('\n') : '')
  const [explanation, setExplanation] = useState(initial?.explanation ?? '')
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 3)
  const [points, setPoints] = useState(String(initial?.points ?? 1))
  const queryClient = useQueryClient()
  const toast = useToast()

  const changeType = (next: QuestionType) => {
    setType(next)
    setKey(key.type === next ? key : emptyKey(next, options.map((o) => o.id)))
  }

  const input = (): QuestionInput => ({
    type,
    statement,
    options: type === 'single' || type === 'multiple' ? options : [],
    key: type === 'short' ? { type, accepted: accepted.split('\n') } : key,
    explanation,
    topic,
    difficulty,
    points: Number(points.replace(',', '.'))
  })

  const save = useMutation({
    mutationFn: () => (initial ? window.api.questions.update(initial.id, input()) : window.api.questions.create(bankId, input())),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['questions', bankId] })
      onSaved()
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const remove = useMutation({
    mutationFn: () => window.api.questions.delete(initial!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['questions', bankId] })
      toast('Questão excluída')
      onSaved()
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const isCorrect = (id: string) => (key.type === 'single' ? key.correct === id : key.type === 'multiple' ? key.correct.includes(id) : false)
  const toggleCorrect = (id: string) => {
    if (key.type === 'single') setKey({ type: 'single', correct: id })
    if (key.type === 'multiple') setKey({ type: 'multiple', correct: key.correct.includes(id) ? key.correct.filter((x) => x !== id) : [...key.correct, id] })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div className="grid grid-cols-[1fr_8rem_6rem] gap-3">
        <div>
          <Label htmlFor="q-type">Tipo</Label>
          <select id="q-type" value={type} onChange={(e) => changeType(e.target.value as QuestionType)} className={SELECT}>
            {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="q-difficulty">Dificuldade</Label>
          <select id="q-difficulty" value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className={SELECT}>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {['Muito fácil', 'Fácil', 'Média', 'Difícil', 'Muito difícil'][d - 1]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="q-points">Pontos</Label>
          <TextInput id="q-points" type="number" min={0.5} max={100} step="any" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>
      </div>

      <div>
        <Label htmlFor="q-statement">Enunciado</Label>
        <TextArea id="q-statement" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Use $...$ para fórmulas, ex.: Qual a derivada de $x^2$?" data-autofocus />
        {statement.includes('$') && (
          <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
            <span className="mr-2 text-xs text-muted">Prévia:</span>
            <RichText text={statement} />
          </div>
        )}
      </div>

      {(type === 'single' || type === 'multiple') && (
        <div>
          <Label>Alternativas {type === 'single' ? '(marque a correta)' : '(marque todas as corretas)'}</Label>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={o.id} className="flex items-center gap-2">
                <input
                  type={type === 'single' ? 'radio' : 'checkbox'}
                  name="correct"
                  checked={isCorrect(o.id)}
                  onChange={() => toggleCorrect(o.id)}
                  aria-label={`Alternativa ${String.fromCharCode(65 + i)} correta`}
                  className="size-4 accent-[var(--success)]"
                />
                <span className="w-5 text-sm text-muted">{String.fromCharCode(65 + i)}</span>
                <TextInput
                  value={o.text}
                  onChange={(e) => setOptions(options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
                  placeholder={`Alternativa ${String.fromCharCode(65 + i)}`}
                  aria-label={`Texto da alternativa ${String.fromCharCode(65 + i)}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setOptions(options.filter((x) => x.id !== o.id))
                    if (key.type === 'multiple') setKey({ ...key, correct: key.correct.filter((x) => x !== o.id) })
                  }}
                  disabled={options.length <= 2}
                  aria-label="Remover alternativa"
                  className="grid size-8 shrink-0 place-items-center rounded text-muted hover:text-red-400 disabled:opacity-30"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setOptions([...options, { id: newOptionId(), text: '' }])} disabled={options.length >= 10} className="mt-2 inline-flex items-center gap-1.5 text-sm text-accent hover:underline disabled:opacity-40">
            <Plus size={14} /> Adicionar alternativa
          </button>
        </div>
      )}

      {type === 'truefalse' && key.type === 'truefalse' && (
        <div>
          <Label>A afirmação é</Label>
          <div className="flex gap-4 text-sm">
            {[true, false].map((v) => (
              <label key={String(v)} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="tf" checked={key.correct === v} onChange={() => setKey({ type: 'truefalse', correct: v })} className="size-4 accent-[var(--success)]" />
                {v ? 'Verdadeira' : 'Falsa'}
              </label>
            ))}
          </div>
        </div>
      )}

      {type === 'short' && (
        <div>
          <Label htmlFor="q-accepted">Respostas aceitas (uma por linha)</Label>
          <TextArea id="q-accepted" value={accepted} onChange={(e) => setAccepted(e.target.value)} placeholder={'Brasília\nDF'} className="min-h-16" />
          <p className="mt-1 text-xs text-muted">A correção ignora acentos, maiúsculas e espaços extras.</p>
        </div>
      )}

      {type === 'essay' && key.type === 'essay' && (
        <div>
          <Label htmlFor="q-reference">Resposta de referência</Label>
          <TextArea id="q-reference" value={key.reference} onChange={(e) => setKey({ type: 'essay', reference: e.target.value })} className="min-h-16" />
          <p className="mt-1 text-xs text-muted">Dissertativas são corrigidas por você depois de enviar a prova, comparando com esta referência.</p>
        </div>
      )}

      <div className="grid grid-cols-[1fr_14rem] gap-3">
        <div>
          <Label htmlFor="q-explanation">Explicação (aparece na correção)</Label>
          <TextArea id="q-explanation" value={explanation} onChange={(e) => setExplanation(e.target.value)} className="min-h-16" />
        </div>
        <div>
          <Label htmlFor="q-topic">Tópico</Label>
          <TextInput id="q-topic" value={topic} onChange={(e) => setTopic(e.target.value)} list="q-topics" placeholder="Ex.: Derivadas" />
          <datalist id="q-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {initial ? (
          <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-red-400">
            <Trash2 size={16} /> Excluir
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!statement.trim() || save.isPending}>
            {initial ? 'Salvar' : 'Criar questão'}
          </Button>
        </div>
      </div>
    </form>
  )
}
