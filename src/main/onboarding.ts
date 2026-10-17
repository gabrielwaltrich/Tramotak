import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_ONBOARDING,
  normalizeOnboarding,
  onboardingView,
  SAMPLE_CARDS,
  SAMPLE_COURSE_TITLE,
  SAMPLE_QUESTIONS,
  SAMPLE_SET_TITLE,
  type OnboardingState,
  type OnboardingView,
  type SampleInfo
} from '@shared/onboarding'
import { transaction, type Database } from './db/database'
import { deleteCourse, insertScannedCourse } from './db/courses'
import { createCard, createDeck, deleteDeck } from './db/flashcards'
import { createBank, createQuestion, deleteBank } from './db/questions'
import { getInternal, getSettings, setInternal } from './db/settings'
import { scanCourse } from './scanner/scan'

const STATE_KEY = 'onboarding'
const SAMPLE_KEY = 'sampleCourse'

export function getOnboardingState(db: Database): OnboardingState {
  return normalizeOnboarding(getInternal(db, STATE_KEY))
}

function setOnboardingState(db: Database, patch: Partial<OnboardingState>): void {
  setInternal(db, STATE_KEY, { ...DEFAULT_ONBOARDING, ...getOnboardingState(db), ...patch })
}

/** O exemplo instalado, se o curso ainda existe (apagar o curso à mão também "remove" o exemplo). */
export function getSample(db: Database): SampleInfo | null {
  const raw = getInternal(db, SAMPLE_KEY) as Partial<SampleInfo> | undefined
  if (!raw || !Number.isInteger(raw.courseId)) return null
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(raw.courseId!)) return null
  const exists = (table: string, id: unknown) => Number.isInteger(id) && Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id as number))
  return {
    courseId: raw.courseId!,
    deckId: exists('decks', raw.deckId) ? raw.deckId! : null,
    bankId: exists('question_banks', raw.bankId) ? raw.bankId! : null
  }
}

const count = (db: Database, sql: string, ...params: number[]) => (db.prepare(sql).get(...params) as { n: number }).n

export function getOnboarding(db: Database): OnboardingView {
  const sample = getSample(db)
  const courses = count(db, 'SELECT COUNT(*) AS n FROM courses')
  return onboardingView(
    getOnboardingState(db),
    {
      courses,
      ownCourses: sample ? courses - 1 : courses,
      watched: count(db, 'SELECT COUNT(*) AS n FROM lesson_progress WHERE last_watched_at IS NOT NULL OR completed_at IS NOT NULL') > 0,
      notes: count(db, 'SELECT COUNT(*) AS n FROM notes') > 0,
      cardReviews: count(db, 'SELECT COUNT(*) AS n FROM reviews') > 0,
      examAttempts: count(db, "SELECT COUNT(*) AS n FROM attempts WHERE status = 'submitted'") > 0,
      aiConfigured: getSettings(db).aiProvider !== 'none'
    },
    sample
  )
}

/** Boas-vindas concluídas ou puladas: não aparecem mais sozinhas e a lista do Início passa a valer. */
export function finishWelcome(db: Database): void {
  setOnboardingState(db, { welcome: 'done', started: true })
}

/** "Ver a introdução de novo": reabre as boas-vindas e volta a mostrar a lista. */
export function reopenWelcome(db: Database): void {
  setOnboardingState(db, { welcome: 'requested', stepsDismissed: false })
}

export function dismissSteps(db: Database): void {
  setOnboardingState(db, { stepsDismissed: true })
}

/** Pasta do exemplo dentro dos dados do app: o instalador (ou o AppImage) muda de lugar, a cópia não. */
export const sampleTarget = (userData: string) => join(userData, 'exemplo', SAMPLE_COURSE_TITLE)

/**
 * Copia o curso de exemplo para a pasta de dados e importa como um curso comum, com o baralho e o banco de questões
 * de exemplo ligados às aulas. Se já estiver instalado, devolve o que existe.
 */
export async function installSample(db: Database, sourceDir: string, userData: string): Promise<SampleInfo> {
  const current = getSample(db)
  if (current) return current
  const source = join(sourceDir, SAMPLE_COURSE_TITLE)
  if (!existsSync(source)) throw new Error('O curso de exemplo não veio com esta instalação')
  const root = sampleTarget(userData)
  // Restos de um exemplo anterior (curso apagado à mão) saem antes: a pasta é só do app.
  const stale = db.prepare('SELECT id FROM courses WHERE root_path = ?').get(root) as { id: number } | undefined
  if (stale) deleteCourse(db, stale.id)
  rmSync(root, { recursive: true, force: true })
  cpSync(source, root, { recursive: true })
  const scan = await scanCourse(root, { structure: 'auto', numbering: 'dot' })

  const info = transaction(db, (): SampleInfo => {
    const courseId = insertScannedCourse(db, { title: SAMPLE_COURSE_TITLE, rootPath: root, numbering: 'dot', scanStructure: 'auto' }, scan)
    const lessonByPath = new Map(
      (db.prepare('SELECT id, rel_path AS relPath FROM lessons WHERE course_id = ?').all(courseId) as { id: number; relPath: string }[]).map((l) => [
        l.relPath.replace(/\\/g, '/'),
        l.id
      ])
    )
    // Baralho e banco que sobraram de um exemplo anterior (o curso foi apagado à mão) são reaproveitados, com as cartas
    // religadas às aulas novas: nada de "Exemplo" repetido.
    const previous = getInternal(db, SAMPLE_KEY) as Partial<SampleInfo> | undefined
    const alive = (table: string, id: unknown) => Number.isInteger(id) && Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id as number))
    let deckId: number
    if (alive('decks', previous?.deckId)) {
      deckId = previous!.deckId!
      db.prepare('UPDATE decks SET course_id = ? WHERE id = ?').run(courseId, deckId)
      const relink = db.prepare('UPDATE cards SET lesson_id = ? WHERE deck_id = ? AND front = ?')
      for (const card of SAMPLE_CARDS) relink.run(lessonByPath.get(card.lesson) ?? null, deckId, card.front)
    } else {
      deckId = createDeck(db, { title: SAMPLE_SET_TITLE, courseId })
      for (const card of SAMPLE_CARDS) createCard(db, { deckId, front: card.front, back: card.back, lessonId: lessonByPath.get(card.lesson) ?? null })
    }
    let bankId: number
    if (alive('question_banks', previous?.bankId)) bankId = previous!.bankId!
    else {
      bankId = createBank(db, { title: SAMPLE_SET_TITLE, description: 'Questões de exemplo sobre recordação ativa, revisão espaçada e flashcards.' })
      for (const q of SAMPLE_QUESTIONS) createQuestion(db, bankId, q)
    }
    return { courseId, deckId, bankId }
  })
  setInternal(db, SAMPLE_KEY, info)
  // Instalado no meio das boas-vindas, o exemplo vira o primeiro curso: elas continuam abertas até a pessoa concluir.
  if (getOnboardingState(db).welcome === 'pending') setOnboardingState(db, { welcome: 'requested' })
  return info
}

/** Apaga o curso, o baralho e o banco de exemplo e a cópia dos arquivos. */
export function removeSample(db: Database, userData: string): void {
  const raw = getInternal(db, SAMPLE_KEY) as Partial<SampleInfo> | undefined
  transaction(db, () => {
    if (raw && Number.isInteger(raw.courseId)) deleteCourse(db, raw.courseId!)
    if (raw && Number.isInteger(raw.deckId) && db.prepare('SELECT 1 FROM decks WHERE id = ?').get(raw.deckId!)) deleteDeck(db, raw.deckId!)
    if (raw && Number.isInteger(raw.bankId) && db.prepare('SELECT 1 FROM question_banks WHERE id = ?').get(raw.bankId!)) deleteBank(db, raw.bankId!)
    setInternal(db, SAMPLE_KEY, null)
  })
  rmSync(join(userData, 'exemplo'), { recursive: true, force: true })
}
