import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAN,
  buildPlan,
  formatMinutes,
  lessonMinutes,
  studyDates,
  typicalVideoSeconds,
  validatePlanSettings,
  type PlanSettings
} from '@shared/studyPlan'
import { openDatabase, type Database } from '../../src/main/db/database'
import { deleteCourse, getCourseDetail, insertScannedCourse, orderedLessons } from '../../src/main/db/courses'
import { setCompleted, setDuration } from '../../src/main/db/lessons'
import { listTasks, tasksForToday } from '../../src/main/db/planner'
import { autoReplan, deletePlan, getPlan, listPlans, previewPlan, replan, savePlan } from '../../src/main/db/studyPlan'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

// 11/10/2026 é um domingo; 12/10, segunda.
const SUNDAY = '2026-10-11'
const lessons = (minutes: number[]) => minutes.map((m, i) => ({ id: i + 1, minutes: m }))
const plan = (patch: Partial<PlanSettings>): PlanSettings => ({ ...DEFAULT_PLAN, ...patch })

describe('cálculo do plano', () => {
  it('duração típica e minutos de cada aula', () => {
    const list = [
      { id: 1, kind: 'video' as const, durationSec: 600 },
      { id: 2, kind: 'video' as const, durationSec: 1200 },
      { id: 3, kind: 'video' as const, durationSec: 300 },
      { id: 4, kind: 'video' as const, durationSec: null },
      { id: 5, kind: 'text' as const, durationSec: null }
    ]
    const typical = typicalVideoSeconds(list)
    expect(typical).toBe(600)
    expect(lessonMinutes(list[1], typical, 1)).toBe(20)
    expect(lessonMinutes(list[1], typical, 2)).toBe(10)
    expect(lessonMinutes(list[3], typical, 1)).toBe(10) // sem duração: a típica do curso
    expect(lessonMinutes(list[4], typical, 2)).toBe(10) // texto: leitura, sem velocidade
    expect(typicalVideoSeconds([])).toBe(600)
  })

  it('dias de estudo respeitam os dias da semana', () => {
    expect(studyDates(SUNDAY, '2026-10-18', [1, 3, 5])).toEqual(['2026-10-12', '2026-10-14', '2026-10-16'])
    expect(studyDates('2026-10-20', SUNDAY, [0])).toEqual([])
  })

  it('data-alvo: divide igualmente e mantém a ordem', () => {
    const result = buildPlan(lessons(Array(10).fill(10)), plan({ targetDate: '2026-10-16' }), SUNDAY)
    expect(result.days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])
    expect(result.days.map((d) => d.lessonIds)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]])
    expect(result).toMatchObject({ totalMinutes: 100, minutesPerDay: 20, endDate: '2026-10-16', warning: null })
  })

  it('data-alvo com aulas de tamanhos diferentes: nunca passa da data e a ordem fica', () => {
    const result = buildPlan(lessons([60, 5, 5, 5, 5, 40, 3, 3, 3, 3]), plan({ targetDate: '2026-10-14' }), SUNDAY)
    expect(result.days.length).toBeLessThanOrEqual(3)
    expect(result.days.flatMap((d) => d.lessonIds)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.endDate! <= '2026-10-14').toBe(true)
  })

  it('ritmo: enche cada dia até os minutos escolhidos e pula o fim de semana', () => {
    const result = buildPlan(lessons([12, 12, 12, 12, 12, 90, 12]), plan({ mode: 'pace', minutesPerDay: 30 }), '2026-10-15')
    expect(result.days.map((d) => [d.date, d.lessonIds])).toEqual([
      ['2026-10-15', [1, 2]],
      ['2026-10-16', [3, 4]],
      ['2026-10-19', [5]], // aula de 90 min não cabe junto
      ['2026-10-20', [6]], // e fica sozinha no dia dela
      ['2026-10-21', [7]]
    ])
    expect(result.endDate).toBe('2026-10-21')
  })

  it('sem dia de estudo até a data-alvo, usa o ritmo e avisa', () => {
    const result = buildPlan(lessons([10, 10]), plan({ targetDate: SUNDAY, minutesPerDay: 15 }), SUNDAY)
    expect(result.days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13'])
    expect(result.warning).toMatch(/nova data/)
  })

  it('avisa quando o plano fica pesado', () => {
    const result = buildPlan(lessons(Array(30).fill(60)), plan({ targetDate: '2026-10-13' }), SUNDAY)
    expect(result.warning).toMatch(/900 min por dia/)
  })

  it('valida as opções', () => {
    expect(() => validatePlanSettings({ ...DEFAULT_PLAN, weekdays: [] }, SUNDAY)).toThrow('dia da semana')
    expect(() => validatePlanSettings({ ...DEFAULT_PLAN, targetDate: null }, SUNDAY)).toThrow('data')
    expect(() => validatePlanSettings({ ...DEFAULT_PLAN, targetDate: '2026-10-01' }, SUNDAY)).toThrow('já passou')
    expect(() => validatePlanSettings({ ...DEFAULT_PLAN, mode: 'pace', minutesPerDay: 2 }, SUNDAY)).toThrow('Minutos')
    expect(validatePlanSettings({ ...DEFAULT_PLAN, mode: 'pace', weekdays: [5, 1, 1, 9] }, SUNDAY).weekdays).toEqual([1, 5])
  })

  it('formata minutos', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(80)).toBe('1 h 20 min')
    expect(formatMinutes(180)).toBe('3 h')
  })
})

describe('plano no banco e no Planner', () => {
  let db: Database
  let cleanup: () => Promise<void>
  let courseId: number
  let ids: number[]
  const sunday = new Date(2026, 9, 11, 15, 0)
  const at = (day: number, hour = 10) => new Date(2026, 9, day, hour, 0)
  const sec = (d: Date) => Math.floor(d.getTime() / 1000)

  beforeEach(async () => {
    db = openDatabase(':memory:')
    const course = await makeCourse(Array.from({ length: 8 }, (_, i) => `1. Mod/${i + 1}. Aula ${i + 1}.mp4`))
    cleanup = course.cleanup
    const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
    courseId = insertScannedCourse(db, { title: 'Cálculo', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
    ids = orderedLessons(getCourseDetail(db, courseId)).map((l) => l.id)
    ids.forEach((id) => setDuration(db, id, 15 * 60)) // 8 aulas de 15 min
  })
  afterEach(async () => {
    db.close()
    await cleanup()
  })

  const pace30 = { ...DEFAULT_PLAN, mode: 'pace' as const, minutesPerDay: 30 }

  it('gera uma tarefa por dia com as aulas do dia', () => {
    const view = savePlan(db, courseId, pace30, undefined, sunday)
    expect(view.status).toMatchObject({ remainingLessons: 8, remainingMinutes: 120, behindLessons: 0, unplannedLessons: 0, endDate: '2026-10-15' })
    const tasks = listTasks(db).filter((t) => t.planId === view.id)
    expect(tasks.map((t) => [t.scheduledDate, t.durationMin, t.courseId])).toEqual([
      ['2026-10-12', 30, courseId],
      ['2026-10-13', 30, courseId],
      ['2026-10-14', 30, courseId],
      ['2026-10-15', 30, courseId]
    ])
    expect(tasks[0].title).toBe('2 aulas · Aula 1 → Aula 2')
    expect(tasks[0].planLessons).toEqual([
      { id: ids[0], title: 'Aula 1', completed: false },
      { id: ids[1], title: 'Aula 2', completed: false }
    ])
    expect(tasksForToday(db, at(12)).map((t) => t.planLessons?.length)).toEqual([2])
  })

  it('a prévia não grava nada e conta os outros planos', () => {
    const preview = previewPlan(db, courseId, { ...DEFAULT_PLAN, targetDate: '2026-10-13' }, undefined, sunday)
    expect(preview.result.days).toHaveLength(2)
    expect(preview.remainingLessons).toBe(8)
    expect(preview.estimatedLessons).toBe(0)
    expect(listTasks(db)).toHaveLength(0)
    expect(() => previewPlan(db, courseId, { ...DEFAULT_PLAN, targetDate: '2026-10-13' }, '2026-10-01', sunday)).toThrow('passado')
  })

  it('concluir todas as aulas do dia conclui a tarefa; aulas adiantadas também contam', () => {
    savePlan(db, courseId, pace30, undefined, sunday)
    setCompleted(db, ids[0], true, sec(at(12)))
    expect(listTasks(db).find((t) => t.scheduledDate === '2026-10-12')!.status).toBe('todo')
    setCompleted(db, ids[1], true, sec(at(12)))
    expect(listTasks(db).find((t) => t.scheduledDate === '2026-10-12')!.status).toBe('done')
    // Adiantou as aulas de quarta
    setCompleted(db, ids[4], true, sec(at(12)))
    setCompleted(db, ids[5], true, sec(at(12)))
    expect(listTasks(db).find((t) => t.scheduledDate === '2026-10-14')!.status).toBe('done')
  })

  it('atrasou: conta as aulas atrasadas e o replanejamento empurra para frente', () => {
    const view = savePlan(db, courseId, pace30, undefined, sunday)
    setCompleted(db, ids[0], true, sec(at(12)))
    setCompleted(db, ids[1], true, sec(at(12)))
    // Terça e quarta passaram sem estudo
    const thursday = at(15)
    expect(getPlan(db, courseId, thursday)!.status.behindLessons).toBe(4)
    expect(autoReplan(db, thursday)).toEqual([courseId])
    const after = getPlan(db, courseId, thursday)!
    expect(after.status).toMatchObject({ behindLessons: 0, remainingLessons: 6, unplannedLessons: 0, endDate: '2026-10-19' })
    expect(after.replannedAt).toBe(sec(thursday))
    // A segunda concluída fica como histórico; o resto recomeça na quinta
    const byDate = listTasks(db).filter((t) => t.planId === view.id).sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!))
    expect(byDate.map((t) => [t.scheduledDate, t.status])).toEqual([
      ['2026-10-12', 'done'],
      ['2026-10-15', 'todo'],
      ['2026-10-16', 'todo'],
      ['2026-10-19', 'todo']
    ])
    // Nada atrasado: não replaneja de novo
    expect(autoReplan(db, thursday)).toEqual([])
  })

  it('sem replanejamento automático, só replaneja quando pedir', () => {
    savePlan(db, courseId, { ...pace30, autoReplan: false }, undefined, sunday)
    expect(autoReplan(db, at(15))).toEqual([])
    expect(getPlan(db, courseId, at(15))!.status.behindLessons).toBe(6)
    expect(replan(db, courseId, at(15)).status.behindLessons).toBe(0)
  })

  it('replanejar depois de concluir o dia de hoje começa amanhã', () => {
    savePlan(db, courseId, pace30, undefined, sunday)
    setCompleted(db, ids[0], true, sec(at(12)))
    setCompleted(db, ids[1], true, sec(at(12)))
    const view = replan(db, courseId, at(12, 18))
    expect(view.status.upcoming.map((d) => [d.date, d.done])).toEqual([
      ['2026-10-12', true],
      ['2026-10-13', false],
      ['2026-10-14', false],
      ['2026-10-15', false]
    ])
  })

  it('previsão pelo ritmo real dos últimos 14 dias', () => {
    savePlan(db, courseId, pace30, undefined, sunday)
    expect(getPlan(db, courseId, at(12))!.status.forecastDate).toBeNull()
    for (const id of ids.slice(0, 2)) setCompleted(db, id, true, sec(at(12)))
    // 30 min em 14 dias ≈ 2,1 min/dia; faltam 90 min → 42 dias
    const status = getPlan(db, courseId, at(12, 18))!.status
    expect(status.recentMinutesPerDay).toBeCloseTo(30 / 14)
    expect(status.forecastDate).toBe('2026-11-23')
  })

  it('apagar o plano mantém as tarefas concluídas como tarefas comuns', () => {
    const view = savePlan(db, courseId, pace30, undefined, sunday)
    setCompleted(db, ids[0], true, sec(at(12)))
    setCompleted(db, ids[1], true, sec(at(12)))
    deletePlan(db, courseId)
    expect(getPlan(db, courseId)).toBeNull()
    const tasks = listTasks(db)
    expect(tasks.map((t) => [t.status, t.planId, t.planLessons])).toEqual([['done', null, null]])
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_lessons').get()).toEqual({ n: 0 })
    void view
  })

  it('salvar de novo substitui o plano; excluir o curso leva o plano junto', () => {
    savePlan(db, courseId, pace30, undefined, sunday)
    savePlan(db, courseId, { ...DEFAULT_PLAN, targetDate: '2026-10-13' }, undefined, sunday)
    expect(listTasks(db).map((t) => t.scheduledDate)).toEqual(['2026-10-12', '2026-10-13'])
    expect(listPlans(db, sunday)).toHaveLength(1)
    deleteCourse(db, courseId)
    expect(listPlans(db, sunday)).toHaveLength(0)
    expect(listTasks(db)).toHaveLength(0)
  })

  it('curso já concluído não ganha plano', () => {
    for (const id of ids) setCompleted(db, id, true, sec(sunday))
    expect(() => savePlan(db, courseId, pace30, undefined, sunday)).toThrow('concluídas')
  })
})
