import { Check, X } from 'lucide-react'
import type { AttemptQuestion } from '@shared/exams'
import type { QuestionAnswer } from '@shared/questions'
import { RichText } from '../RichText'
import { TextArea, TextInput } from '../Field'

const LETTER = (i: number) => String.fromCharCode(65 + i)

/**
 * Campo de resposta de cada tipo. Com `question.key` presente (correção revelada),
 * marca certas em verde e escolhas erradas em vermelho.
 */
export function AnswerInput({ question, answer, onChange, readOnly }: {
  question: AttemptQuestion
  answer: QuestionAnswer | null
  onChange: (answer: QuestionAnswer) => void
  readOnly: boolean
}) {
  const key = question.key

  if (question.type === 'single' || question.type === 'multiple') {
    const chosen = new Set(
      answer?.type === 'single' ? (answer.choice ? [answer.choice] : []) : answer?.type === 'multiple' ? answer.choices : []
    )
    const correct = new Set(key?.type === 'single' ? [key.correct] : key?.type === 'multiple' ? key.correct : [])
    const pick = (id: string) => {
      if (readOnly) return
      if (question.type === 'single') onChange({ type: 'single', choice: id })
      else onChange({ type: 'multiple', choices: chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id] })
    }
    return (
      <div role={question.type === 'single' ? 'radiogroup' : 'group'} aria-label="Alternativas" className="space-y-2">
        {question.type === 'multiple' && !readOnly && <p className="text-xs text-muted">Marque todas as corretas.</p>}
        {question.options.map((o, i) => {
          const isChosen = chosen.has(o.id)
          const isRight = key !== undefined && correct.has(o.id)
          const isWrong = key !== undefined && isChosen && !correct.has(o.id)
          return (
            <button
              key={o.id}
              type="button"
              role={question.type === 'single' ? 'radio' : 'checkbox'}
              aria-checked={isChosen}
              disabled={readOnly}
              onClick={() => pick(o.id)}
              className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition ${
                isRight ? 'border-success/60 bg-success/10'
                : isWrong ? 'border-red-500/60 bg-red-500/10'
                : isChosen ? 'border-accent bg-accent-soft'
                : 'border-border hover:border-accent/50'
              } ${readOnly ? 'cursor-default' : ''}`}
            >
              <span className={`grid size-6 shrink-0 place-items-center rounded-${question.type === 'single' ? 'full' : 'md'} border text-xs font-medium ${isChosen ? 'border-accent bg-accent text-on-accent' : 'border-border text-muted'}`}>
                {LETTER(i)}
              </span>
              <span className="flex-1 pt-0.5">
                <RichText text={o.text} />
              </span>
              {isRight && <Check size={18} className="shrink-0 text-success" aria-label="correta" />}
              {isWrong && <X size={18} className="shrink-0 text-red-400" aria-label="errada" />}
            </button>
          )
        })}
      </div>
    )
  }

  if (question.type === 'truefalse') {
    const value = answer?.type === 'truefalse' ? answer.value : null
    return (
      <div role="radiogroup" aria-label="Verdadeiro ou falso" className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => {
          const isChosen = value === v
          const isRight = key?.type === 'truefalse' && key.correct === v
          const isWrong = key !== undefined && isChosen && !isRight
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={readOnly}
              onClick={() => !readOnly && onChange({ type: 'truefalse', value: v })}
              className={`h-14 rounded-lg border text-sm font-medium ${
                isRight ? 'border-success/60 bg-success/10 text-success'
                : isWrong ? 'border-red-500/60 bg-red-500/10 text-red-400'
                : isChosen ? 'border-accent bg-accent-soft text-accent'
                : 'border-border hover:border-accent/50'
              }`}
            >
              {v ? 'Verdadeiro' : 'Falso'}
            </button>
          )
        })}
      </div>
    )
  }

  const text = answer?.type === question.type ? answer.text : ''
  return (
    <div className="space-y-2">
      {question.type === 'short' ? (
        <TextInput
          value={text}
          onChange={(e) => onChange({ type: 'short', text: e.target.value })}
          readOnly={readOnly}
          placeholder="Sua resposta"
          aria-label="Sua resposta"
        />
      ) : (
        <TextArea
          value={text}
          onChange={(e) => onChange({ type: 'essay', text: e.target.value })}
          readOnly={readOnly}
          placeholder="Escreva sua resposta"
          aria-label="Sua resposta"
          className="min-h-40"
        />
      )}
      {key?.type === 'short' && (
        <p className="text-sm text-muted">
          Respostas aceitas: <span className="text-success">{key.accepted.join(' · ')}</span>
        </p>
      )}
      {key?.type === 'essay' && key.reference && (
        <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <p className="mb-1 text-xs text-muted">Resposta de referência</p>
          <RichText text={key.reference} />
        </div>
      )}
    </div>
  )
}
