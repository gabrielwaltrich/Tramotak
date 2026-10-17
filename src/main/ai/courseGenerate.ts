import { AI_PROVIDERS, buildPrompt, fitSource, maxOutputTokens, parseResult, validateRequest, type AiProvider } from '@shared/ai'
import type { CourseDetail, CourseModuleNode } from '@shared/course'
import {
  isTransientAiError,
  MAX_TOTAL_LIMITS,
  MIN_LESSON_CHARS,
  PER_LESSON_LIMITS,
  planCounts,
  type CourseGenerateProgress,
  type CourseGenerateRequest,
  type CourseMaterialSummary
} from '@shared/courseGenerate'
import { normalize } from '@shared/search'
import type { Database } from '../db/database'
import { getCourseDetail } from '../db/courses'
import { createCard, createDeck, getDeck } from '../db/flashcards'
import { createBank, createQuestion, getBank, listQuestions } from '../db/questions'
import { chat, type AiClientConfig } from './client'
import { syncCourseChunks } from './courseIndex'

const HEADING: Record<string, string> = {
  transcript: 'Transcrição automática da fala',
  subtitle: 'Legenda (texto falado)',
  text: 'Conteúdo escrito',
  pdf: 'Conteúdo escrito'
}

/** Aulas do escopo, na ordem do curso: o curso inteiro ou os módulos escolhidos (com os submódulos). */
export function scopeLessons(course: CourseDetail, moduleIds: number[]): number[] {
  const wanted = new Set(moduleIds)
  const out: number[] = moduleIds.length ? [] : course.lessons.map((l) => l.id)
  const walk = (mods: CourseModuleNode[], inside: boolean) => {
    for (const m of mods) {
      const take = inside || wanted.size === 0 || wanted.has(m.id)
      if (take) out.push(...m.lessons.map((l) => l.id))
      walk(m.children, take)
    }
  }
  walk(course.modules, false)
  return out
}

/** Caracteres de material (trechos do curso) de cada aula. */
function charsByLesson(db: Database, lessonIds: number[]): Map<number, number> {
  if (!lessonIds.length) return new Map()
  const rows = db
    .prepare(`SELECT lesson_id AS lessonId, SUM(length(text)) AS chars FROM course_chunks WHERE lesson_id IN (${lessonIds.map(() => '?').join(',')}) GROUP BY lesson_id`)
    .all(...lessonIds) as { lessonId: number; chars: number }[]
  return new Map(rows.map((r) => [r.lessonId, r.chars]))
}

/** O que há para gerar no escopo (atualiza antes os trechos do curso, só o que mudou). */
export async function courseMaterialSummary(db: Database, courseId: number, moduleIds: number[]): Promise<CourseMaterialSummary> {
  await syncCourseChunks(db, courseId)
  const course = getCourseDetail(db, courseId)
  const lessons = scopeLessons(course, moduleIds)
  const chars = charsByLesson(db, scopeLessons(course, []))
  const usable = (id: number) => (chars.get(id) ?? 0) >= MIN_LESSON_CHARS
  return {
    lessons: lessons.filter(usable).length,
    total: lessons.length,
    chars: lessons.reduce((sum, id) => sum + (chars.get(id) ?? 0), 0),
    modules: course.modules.map((m) => {
      const ids = scopeLessons({ ...course, lessons: [], modules: [m] }, [])
      return { id: m.id, title: m.title, lessons: ids.length, withMaterial: ids.filter(usable).length }
    })
  }
}

/** Material de uma aula para a IA: os trechos em ordem, sob um cabeçalho neutro (sem título nem arquivo). */
export function lessonMaterialText(db: Database, lessonId: number): string {
  const kind = (db.prepare('SELECT kind FROM chunk_sources WHERE lesson_id = ?').get(lessonId) as { kind: string } | undefined)?.kind
  const rows = db.prepare('SELECT text FROM course_chunks WHERE lesson_id = ? ORDER BY rowid').all(lessonId) as { text: string }[]
  if (!kind || !rows.length) return ''
  return `## ${HEADING[kind] ?? 'Conteúdo'}\n${rows.map((r) => r.text).join('\n\n')}`
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('Cancelado'))), { once: true })
  })

interface RunDeps {
  db: Database
  provider: AiProvider
  config: AiClientConfig
  signal: AbortSignal
  onProgress: (p: CourseGenerateProgress) => void
  /** Espera antes de tentar de novo depois de um limite de uso (os testes encurtam). */
  retryDelayMs?: number
  /** Para depois de tantas aulas seguidas com erro (ex.: chave recusada). */
  maxConsecutiveFailures?: number
}

/**
 * Gera aula por aula e salva cada resultado na hora (cancelar não perde o que já foi feito). Itens repetidos (já no
 * baralho/banco) e os que falam do vídeo em vez do assunto são descartados.
 */
export async function runCourseGeneration(input: CourseGenerateRequest, deps: RunDeps): Promise<CourseGenerateProgress> {
  const { db, signal } = deps
  const task = input.task === 'questions' ? 'questions' : 'cards'
  const perLesson = Math.min(PER_LESSON_LIMITS.max, Math.max(PER_LESSON_LIMITS.min, Math.round(Number(input.perLesson) || 3)))
  const maxTotal = Math.min(MAX_TOTAL_LIMITS.max, Math.max(MAX_TOTAL_LIMITS.min, Math.round(Number(input.maxTotal) || 300)))
  const course = getCourseDetail(db, input.courseId)
  await syncCourseChunks(db, course.id)
  const ids = scopeLessons(course, Array.isArray(input.moduleIds) ? input.moduleIds.filter(Number.isInteger) : [])
  const chars = charsByLesson(db, ids)
  const plan = planCounts(
    ids.map((id) => ({ lessonId: id, chars: chars.get(id) ?? 0 })),
    perLesson,
    maxTotal
  )
  if (!plan.length) throw new Error('Nenhuma aula escolhida tem transcrição, legenda, texto ou PDF para a IA ler.')

  // Destino: existente ou novo (o baralho novo fica ligado ao curso).
  let targetId: number
  let targetTitle: string
  const seen = new Set<string>()
  const newTitle = String(input.newTitle ?? '').trim().slice(0, 200) || `${course.title} — ${task === 'cards' ? 'flashcards' : 'questões'} da IA`
  if (task === 'cards') {
    targetId = input.targetId !== null && Number.isInteger(input.targetId) ? input.targetId : createDeck(db, { title: newTitle, courseId: course.id })
    const deck = getDeck(db, targetId)
    targetTitle = deck.title
    for (const c of deck.cards) seen.add(normalize(c.front))
  } else {
    targetId = input.targetId !== null && Number.isInteger(input.targetId) ? input.targetId : createBank(db, { title: newTitle })
    targetTitle = getBank(db, targetId).title
    for (const q of listQuestions(db, targetId)) seen.add(normalize(q.statement))
  }

  const progress: CourseGenerateProgress = {
    task,
    courseId: course.id,
    targetId,
    targetTitle,
    done: 0,
    total: plan.length,
    saved: 0,
    discarded: 0,
    failed: 0,
    lastError: null,
    finished: false,
    canceled: false,
    error: null
  }
  const emit = () => deps.onProgress({ ...progress })
  emit()

  const limit = AI_PROVIDERS[deps.provider].maxSourceChars
  let failuresInARow = 0
  for (const item of plan) {
    if (signal.aborted) break
    try {
      const req = validateRequest({
        task,
        title: '',
        text: lessonMaterialText(db, item.lessonId),
        count: item.count,
        questionTypes: task === 'questions' ? input.questionTypes : [],
        instructions: input.instructions,
        webSearch: false
      })
      const { text } = fitSource(req.text, limit)
      const prompt = buildPrompt(req, text)
      let answer: string | null = null
      for (let attempt = 0; answer === null; attempt++) {
        try {
          answer = (await chat(deps.config, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], maxTokens: maxOutputTokens(req), json: true }, signal)).text
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (signal.aborted || attempt >= 2 || !isTransientAiError(message)) throw error
          await sleep((deps.retryDelayMs ?? 20_000) * (attempt + 1), signal)
        }
      }
      const result = parseResult(req, answer)
      // A IA às vezes devolve mais do que o pedido: fica só a quantidade da aula.
      let room = item.count
      if (result.task === 'cards') {
        progress.discarded += result.discarded ?? 0
        for (const c of result.cards) {
          const key = normalize(c.front)
          if (seen.has(key) || room <= 0) {
            progress.discarded++
            continue
          }
          seen.add(key)
          createCard(db, { deckId: targetId, front: c.front, back: c.back, lessonId: item.lessonId })
          progress.saved++
          room--
        }
      } else if (result.task === 'questions') {
        progress.discarded += result.discarded ?? 0
        for (const q of result.questions) {
          const key = normalize(q.statement)
          if (seen.has(key) || room <= 0) {
            progress.discarded++
            continue
          }
          seen.add(key)
          createQuestion(db, targetId, q)
          progress.saved++
          room--
        }
      }
      failuresInARow = 0
    } catch (error) {
      if (signal.aborted) break
      progress.failed++
      progress.lastError = error instanceof Error ? error.message : String(error)
      failuresInARow++
      if (failuresInARow >= (deps.maxConsecutiveFailures ?? 3)) {
        progress.error = `Parou depois de ${failuresInARow} aulas seguidas com erro: ${progress.lastError}`
        break
      }
    }
    progress.done++
    emit()
  }
  progress.canceled = signal.aborted
  progress.finished = true
  emit()
  return progress
}
