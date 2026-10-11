import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { answerCard, createCard, createDeck } from '../../src/main/db/flashcards'
import { saveProgress, setCompleted } from '../../src/main/db/lessons'
import { createNote } from '../../src/main/db/notes'
import { ACTIVITY_DAYS, getProgress, watchHistory } from '../../src/main/db/progress'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let cleanups: (() => Promise<void>)[] = []
const now = new Date(2026, 9, 11, 15, 0)
const at = (day: number, hour = 12) => Math.floor(new Date(2026, 9, day, hour).getTime() / 1000)

async function addCourse(title: string, files: string[]) {
  const course = await makeCourse(files)
  cleanups.push(course.cleanup)
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  return insertScannedCourse(db, { title, rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
}
const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(async () => {
  db.close()
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

describe('getProgress', () => {
  it('banco vazio', () => {
    const p = getProgress(db, now)
    expect(p.daily).toHaveLength(ACTIVITY_DAYS)
    expect(p.daily.at(-1)).toEqual({ date: '2026-10-11', seconds: 0 })
    expect(p.totals).toEqual({ studySeconds: 0, lessonsCompleted: 0, coursesStarted: 0, coursesCompleted: 0, notes: 0, reviews: 0 })
    expect(p.flashcards.retention30d).toBeNull()
  })

  it('agrega estudo por dia, cursos e sequência', async () => {
    await addCourse('Física', ['1. A.mp4', '2. B.mp4'])
    await addCourse('Química', ['1. C.mp4'])
    saveProgress(db, { lessonId: lessonId('A'), positionSec: 10, durationSec: 60, watchedSec: 300 }, at(10))
    saveProgress(db, { lessonId: lessonId('B'), positionSec: 10, durationSec: 60, watchedSec: 600 }, at(11))
    setCompleted(db, lessonId('A'), true)
    setCompleted(db, lessonId('B'), true)
    createNote(db, { lessonId: lessonId('A'), timestampSec: 1, body: 'x' })

    const p = getProgress(db, now)
    expect(p.daily.slice(-2)).toEqual([
      { date: '2026-10-10', seconds: 300 },
      { date: '2026-10-11', seconds: 600 }
    ])
    expect(p.streak).toEqual({ current: 2, todayDone: true, best: 2 })
    expect(p.totals).toMatchObject({ studySeconds: 900, lessonsCompleted: 2, coursesStarted: 1, coursesCompleted: 1, notes: 1 })
    expect(p.courses).toEqual([
      { id: expect.any(Number), title: 'Física', completed: 2, total: 2 },
      { id: expect.any(Number), title: 'Química', completed: 0, total: 1 }
    ])
  })

  it('retenção dos flashcards considera só revisões de cartas graduadas', () => {
    const deckId = createDeck(db, { title: 'D' })
    const mk = (f: string) => createCard(db, { deckId, front: f, back: '' }).id
    const a = mk('a')
    const b = mk('b')
    answerCard(db, a, 4, 0, at(1), () => 0.5) // nova → review (não conta na retenção)
    answerCard(db, b, 4, 0, at(1), () => 0.5)
    answerCard(db, a, 3, 0, at(6), () => 0.5) // acertou
    answerCard(db, b, 1, 0, at(6), () => 0.5) // errou
    const p = getProgress(db, now)
    expect(p.flashcards).toEqual({ cards: { new: 0, learning: 1, review: 1 }, reviews30d: 4, retention30d: 0.5 })
    expect(p.totals.reviews).toBe(4)
  })
})

describe('watchHistory', () => {
  it('ordena por mais recente e filtra por curso, texto sem acento e período', async () => {
    const fisica = await addCourse('Física', ['1. Cinemática.mp4', '2. Dinâmica.mp4'])
    await addCourse('Química', ['1. Átomos.mp4'])
    saveProgress(db, { lessonId: lessonId('Cinemática'), positionSec: 5, durationSec: 60, watchedSec: 0 }, at(1))
    saveProgress(db, { lessonId: lessonId('Átomos'), positionSec: 5, durationSec: 60, watchedSec: 0 }, at(5))
    saveProgress(db, { lessonId: lessonId('Dinâmica'), positionSec: 5, durationSec: 60, watchedSec: 0 }, at(9))

    expect(watchHistory(db).map((h) => h.title)).toEqual(['Dinâmica', 'Átomos', 'Cinemática'])
    expect(watchHistory(db, { courseId: fisica }).map((h) => h.title)).toEqual(['Dinâmica', 'Cinemática'])
    expect(watchHistory(db, { text: 'atomos' }).map((h) => h.title)).toEqual(['Átomos'])
    expect(watchHistory(db, { text: 'fisica' }).map((h) => h.title)).toEqual(['Dinâmica', 'Cinemática'])
    expect(watchHistory(db, { from: '2026-10-02', to: '2026-10-05' }).map((h) => h.title)).toEqual(['Átomos'])
    expect(watchHistory(db)[0]).toMatchObject({ courseTitle: 'Física', positionSec: 5, durationSec: 60, completed: false })
    expect(() => watchHistory(db, { from: 'ontem' })).toThrow('inválida')
  })
})
