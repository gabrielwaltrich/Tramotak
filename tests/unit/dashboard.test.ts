import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { saveProgress, setCompleted } from '../../src/main/db/lessons'
import { getDashboard } from '../../src/main/db/dashboard'
import { getSettings, updateSettings } from '../../src/main/db/settings'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let cleanup: (() => Promise<void>) | undefined
const now = new Date(2026, 9, 11, 15, 0)
const epoch = (d: Date) => Math.floor(d.getTime() / 1000)
const at = (day: number, hour = 12) => epoch(new Date(2026, 9, day, hour, 0))

beforeEach(async () => {
  db = openDatabase(':memory:')
  const course = await makeCourse(['1. Mod/1. A.mp4', '1. Mod/2. B.mp4', '2. Mod/1. C.mp4'])
  cleanup = course.cleanup
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  insertScannedCourse(db, { title: 'Curso', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

const id = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id
const watch = (title: string, when: number, watchedSec = 0, positionSec = 30) =>
  saveProgress(db, { lessonId: id(title), positionSec, durationSec: 600, watchedSec }, when)

describe('painel do Início', () => {
  it('vazio quando nada foi assistido', () => {
    expect(getDashboard(db, now)).toEqual({
      todaySeconds: 0,
      goalMinutes: 60,
      lessonsCompletedToday: 0,
      streak: { current: 0, todayDone: false, best: 0 },
      continueLesson: null
    })
  })

  it('soma só o tempo de hoje e calcula a sequência', () => {
    watch('A', at(9), 300)
    watch('A', at(10), 30) // menos de 60 s: ontem não conta
    watch('A', at(11, 9), 600)
    watch('B', at(11, 14), 120)
    const d = getDashboard(db, now)
    expect(d.todaySeconds).toBe(720)
    expect(d.streak).toEqual({ current: 1, todayDone: true, best: 1 })
  })

  it('sugere a última aula assistida, com a posição salva', () => {
    watch('A', at(11, 9))
    watch('B', at(11, 10), 0, 42)
    expect(getDashboard(db, now).continueLesson).toMatchObject({
      title: 'B', courseTitle: 'Curso', moduleTitle: 'Mod', positionSec: 42, isNext: false
    })
  })

  it('se a última foi concluída, sugere a próxima não concluída (atravessando módulos)', () => {
    setCompleted(db, id('B'), true, at(1))
    watch('A', at(11, 10))
    setCompleted(db, id('A'), true, at(11, 11))
    expect(getDashboard(db, now).continueLesson).toMatchObject({ title: 'C', moduleTitle: 'Mod', isNext: true, positionSec: 0 })
    expect(getDashboard(db, now).lessonsCompletedToday).toBe(1)
  })

  it('curso todo concluído mantém a última aula', () => {
    for (const t of ['A', 'B', 'C']) setCompleted(db, id(t), true)
    watch('C', at(11, 10))
    expect(getDashboard(db, now).continueLesson).toMatchObject({ title: 'C', isNext: false })
  })

  it('usa a meta das configurações', () => {
    updateSettings(db, { dailyGoalMinutes: 90 })
    expect(getDashboard(db, now).goalMinutes).toBe(90)
  })
})

describe('configurações', () => {
  it('valida a faixa da meta e ignora valor guardado inválido', () => {
    expect(() => updateSettings(db, { dailyGoalMinutes: 2 })).toThrow('entre 5 e 480')
    expect(() => updateSettings(db, { dailyGoalMinutes: 30.5 })).toThrow()
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('dailyGoalMinutes', '9999')").run()
    expect(getSettings(db).dailyGoalMinutes).toBe(60)
    expect(updateSettings(db, { dailyGoalMinutes: 45 }).dailyGoalMinutes).toBe(45)
  })
})
