import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ONBOARDING, onboardingView, SAMPLE_CARDS, SAMPLE_QUESTIONS, type UsageFacts } from '../../src/shared/onboarding'
import { openDatabase, type Database } from '../../src/main/db/database'
import { getCourseDetail } from '../../src/main/db/courses'
import { getDeck } from '../../src/main/db/flashcards'
import { listQuestions } from '../../src/main/db/questions'
import { dismissSteps, finishWelcome, getOnboarding, installSample, removeSample, reopenWelcome, sampleTarget } from '../../src/main/onboarding'

const SOURCE = join(__dirname, '..', '..', 'resources', 'sample-course')
const none: UsageFacts = { courses: 0, ownCourses: 0, watched: false, notes: false, cardReviews: false, examAttempts: false, aiConfigured: false }

describe('quando mostrar as boas-vindas e a lista', () => {
  it('instalação nova vê as boas-vindas; quem já tem cursos não é interrompido', () => {
    expect(onboardingView(DEFAULT_ONBOARDING, none, null)).toEqual({ showWelcome: true, steps: null, sample: null })
    expect(onboardingView(DEFAULT_ONBOARDING, { ...none, courses: 3, ownCourses: 3 }, null).showWelcome).toBe(false)
    expect(onboardingView({ ...DEFAULT_ONBOARDING, welcome: 'requested' }, { ...none, courses: 3 }, null).showWelcome).toBe(true)
    expect(onboardingView({ ...DEFAULT_ONBOARDING, welcome: 'done' }, none, null).showWelcome).toBe(false)
  })

  it('a lista aparece depois das boas-vindas, marca o que foi feito e some ao dispensar ou concluir tudo', () => {
    const started = { welcome: 'done' as const, started: true, stepsDismissed: false }
    const view = onboardingView(started, { ...none, courses: 1, watched: true, aiConfigured: true }, null)
    expect(view.steps?.filter((s) => s.done).map((s) => s.id)).toEqual(['watch', 'ai'])
    expect(onboardingView({ ...started, stepsDismissed: true }, none, null).steps).toBeNull()
    const all = { courses: 2, ownCourses: 1, watched: true, notes: true, cardReviews: true, examAttempts: true, aiConfigured: true }
    expect(onboardingView(started, all, null).steps).toBeNull()
    // Só o curso de exemplo não conta como "importe um curso seu".
    expect(onboardingView(started, { ...none, courses: 1, ownCourses: 0 }, null).steps?.find((s) => s.id === 'course')?.done).toBe(false)
  })
})

describe('curso de exemplo', () => {
  let dir: string
  let db: Database

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tramotak-exemplo-'))
    db = openDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('copia para a pasta de dados e importa com baralho e banco ligados às aulas', async () => {
    const info = await installSample(db, SOURCE, dir)
    const course = getCourseDetail(db, info.courseId)
    expect(course.title).toBe('Como usar o Tramotak')
    expect(course.rootPath).toBe(sampleTarget(dir))
    expect(course.modules.map((m) => m.title)).toEqual(['Primeiros passos', 'Estudar com o material', 'Revisar e praticar'])
    const lessons = course.modules.flatMap((m) => m.lessons)
    expect(lessons.map((l) => l.kind)).toEqual(['text', 'video', 'text', 'document', 'text', 'text', 'text', 'text'])
    expect(existsSync(join(sampleTarget(dir), '01. Primeiros passos', '02. O player de vídeo.srt'))).toBe(true)

    const deck = getDeck(db, info.deckId!)
    expect(deck.cards).toHaveLength(SAMPLE_CARDS.length)
    expect(deck.cards.every((c) => c.lessonId !== null)).toBe(true)
    expect(listQuestions(db, info.bankId!)).toHaveLength(SAMPLE_QUESTIONS.length)

    // De novo: devolve o que existe, sem duplicar.
    expect(await installSample(db, SOURCE, dir)).toEqual(info)
    expect((db.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(1)
  })

  it('instalar o exemplo no meio das boas-vindas não as fecha (ele vira o primeiro curso)', async () => {
    expect(getOnboarding(db).showWelcome).toBe(true)
    await installSample(db, SOURCE, dir)
    expect(getOnboarding(db).showWelcome).toBe(true)
    finishWelcome(db)
    expect(getOnboarding(db).showWelcome).toBe(false)
  })

  it('o exemplo não conta como curso seu, e remover apaga curso, baralho, banco e arquivos', async () => {
    await installSample(db, SOURCE, dir)
    finishWelcome(db)
    const view = getOnboarding(db)
    expect(view.showWelcome).toBe(false)
    expect(view.steps?.find((s) => s.id === 'course')?.done).toBe(false)
    expect(view.sample).not.toBeNull()

    removeSample(db, dir)
    expect(getOnboarding(db).sample).toBeNull()
    for (const table of ['courses', 'decks', 'question_banks', 'cards', 'questions']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0)
    }
    expect(existsSync(join(dir, 'exemplo'))).toBe(false)
  })

  it('rever a introdução reabre as boas-vindas e a lista dispensada', () => {
    finishWelcome(db)
    dismissSteps(db)
    expect(getOnboarding(db)).toMatchObject({ showWelcome: false, steps: null })
    reopenWelcome(db)
    const view = getOnboarding(db)
    expect(view.showWelcome).toBe(true)
    finishWelcome(db)
    expect(getOnboarding(db).steps).not.toBeNull()
  })

  it('curso de exemplo apagado à mão pode ser instalado de novo', async () => {
    const first = await installSample(db, SOURCE, dir)
    db.prepare('DELETE FROM courses WHERE id = ?').run(first.courseId)
    const again = await installSample(db, SOURCE, dir)
    expect(getCourseDetail(db, again.courseId).lessonCount).toBe(8)
    // Baralho e banco que sobraram voltam a ser os do exemplo, sem duplicar, com as cartas ligadas às aulas novas.
    expect(again).toMatchObject({ deckId: first.deckId, bankId: first.bankId })
    expect((db.prepare('SELECT COUNT(*) AS n FROM decks').get() as { n: number }).n).toBe(1)
    expect(getDeck(db, again.deckId!).cards.every((c) => c.lessonId !== null && c.courseId === again.courseId)).toBe(true)
  })
})
