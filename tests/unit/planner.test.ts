import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { deleteCourse, insertScannedCourse } from '../../src/main/db/courses'
import { answerCard, createCard, createDeck } from '../../src/main/db/flashcards'
import { calendar, createTask, deleteTask, listTasks, moveTask, setTaskDone, tasksForToday, updateTask } from '../../src/main/db/planner'
import { scanCourse } from '../../src/main/scanner/scan'
import { isDateKey, isTime } from '@shared/planner'
import { makeCourse } from '../helpers/fixture'

let db: Database
const today = new Date(2026, 9, 11, 15, 0)
const nowSec = Math.floor(today.getTime() / 1000)

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

const column = (status: string) => listTasks(db).filter((t) => t.status === status).map((t) => t.title)

describe('validação', () => {
  it('datas e horários', () => {
    expect(isDateKey('2026-02-28')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('11/10/2026')).toBe(false)
    expect(isTime('09:30')).toBe(true)
    expect(isTime('24:00')).toBe(false)
  })

  it('recusa título vazio, horário sem data, duração fora da faixa', () => {
    expect(() => createTask(db, { title: ' ' })).toThrow('título')
    expect(() => createTask(db, { title: 'x', scheduledTime: '10:00' })).toThrow('precisa de uma data')
    expect(() => createTask(db, { title: 'x', scheduledDate: '2026-13-01' })).toThrow('Data inválida')
    expect(() => createTask(db, { title: 'x', durationMin: 0 })).toThrow('Duração')
  })
})

describe('kanban', () => {
  it('cria no fim da coluna, move entre colunas e reordena', () => {
    const a = createTask(db, { title: 'A' })
    createTask(db, { title: 'B' })
    const c = createTask(db, { title: 'C' })
    expect(column('todo')).toEqual(['A', 'B', 'C'])

    moveTask(db, c.id, 'todo', 0)
    expect(column('todo')).toEqual(['C', 'A', 'B'])

    moveTask(db, a.id, 'doing', 0)
    expect(column('todo')).toEqual(['C', 'B'])
    expect(column('doing')).toEqual(['A'])
  })

  it('concluir marca a data; voltar limpa', () => {
    const a = createTask(db, { title: 'A' })
    moveTask(db, a.id, 'done', 0, 500)
    expect(listTasks(db)[0]).toMatchObject({ status: 'done', completedAt: 500 })
    setTaskDone(db, a.id, false)
    expect(listTasks(db)[0]).toMatchObject({ status: 'todo', completedAt: null })
  })

  it('editar troca campos e status; excluir remove', () => {
    const a = createTask(db, { title: 'A' })
    const edited = updateTask(db, a.id, { title: 'Revisar limites', status: 'doing', scheduledDate: '2026-10-12', scheduledTime: '09:00', durationMin: 45 })
    expect(edited).toMatchObject({ title: 'Revisar limites', status: 'doing', scheduledTime: '09:00', durationMin: 45 })
    deleteTask(db, a.id)
    expect(listTasks(db)).toEqual([])
  })
})

describe('Hoje e calendário', () => {
  it('Hoje traz agendadas para hoje e prazos vencidos, sem concluídas', () => {
    createTask(db, { title: 'Hoje 14h', scheduledDate: '2026-10-11', scheduledTime: '14:00' })
    createTask(db, { title: 'Hoje 9h', scheduledDate: '2026-10-11', scheduledTime: '09:00' })
    createTask(db, { title: 'Atrasada', dueDate: '2026-10-05' })
    createTask(db, { title: 'Amanhã', scheduledDate: '2026-10-12' })
    createTask(db, { title: 'Feita', scheduledDate: '2026-10-11', status: 'done' })
    expect(tasksForToday(db, today).map((t) => t.title)).toEqual(['Hoje 9h', 'Hoje 14h', 'Atrasada'])
  })

  it('calendário junta tarefas, prazos e revisões previstas (vencidas contam hoje)', () => {
    createTask(db, { title: 'Bloco', scheduledDate: '2026-10-12' })
    createTask(db, { title: 'Entrega', dueDate: '2026-10-13' })
    const deckId = createDeck(db, { title: 'D' })
    const fresh = createCard(db, { deckId, front: 'nova', back: '' }) // novas não entram
    void fresh
    const easy = createCard(db, { deckId, front: 'fácil', back: '' })
    answerCard(db, easy.id, 4, 0, nowSec - 10 * 86_400, () => 0.5) // venceu há ~6 dias → conta hoje
    const good = createCard(db, { deckId, front: 'boa', back: '' })
    answerCard(db, good.id, 4, 0, nowSec, () => 0.5) // Fácil (FSRS): vence em 8 dias

    const days = calendar(db, '2026-10-11', '2026-10-19', today)
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]))
    expect(days).toHaveLength(9)
    expect(byDate['2026-10-11'].reviewsDue).toBe(1)
    expect(byDate['2026-10-19'].reviewsDue).toBe(1)
    expect(byDate['2026-10-12'].tasks.map((t) => t.title)).toEqual(['Bloco'])
    expect(byDate['2026-10-13'].dueTasks.map((t) => t.title)).toEqual(['Entrega'])
    expect(() => calendar(db, '2026-10-16', '2026-10-11', today)).toThrow('Período')
  })
})

describe('ligação com cursos', () => {
  it('a aula define o curso; excluir o curso mantém a tarefa sem ligação', async () => {
    const course = await makeCourse(['1. Aula.mp4'])
    const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
    const courseId = insertScannedCourse(db, { title: 'Física', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
    const lessonId = (db.prepare('SELECT id FROM lessons').get() as { id: number }).id

    const task = createTask(db, { title: 'Assistir', lessonId })
    expect(task).toMatchObject({ courseId, courseTitle: 'Física', lessonId, lessonTitle: 'Aula' })
    expect(() => createTask(db, { title: 'x', courseId: 999 })).toThrow('Curso não encontrado')

    deleteCourse(db, courseId)
    expect(listTasks(db)[0]).toMatchObject({ title: 'Assistir', courseId: null, lessonId: null })
    await course.cleanup()
  })
})

describe('avisos de bloco', () => {
  it('avisa dentro da antecedência, uma vez só, e ignora blocos antigos', async () => {
    const { takeBlockReminders } = await import('../../src/main/db/planner')
    const at = (h: number, m: number) => new Date(2026, 9, 11, h, m)
    createTask(db, { title: 'Bloco 15h', scheduledDate: '2026-10-11', scheduledTime: '15:00' })
    createTask(db, { title: 'Bloco 9h', scheduledDate: '2026-10-11', scheduledTime: '09:00' })
    createTask(db, { title: 'Sem horário', scheduledDate: '2026-10-11' })

    expect(takeBlockReminders(db, at(14, 50), 5)).toEqual([]) // cedo demais
    expect(takeBlockReminders(db, at(14, 56), 5).map((t) => t.title)).toEqual(['Bloco 15h'])
    expect(takeBlockReminders(db, at(14, 57), 5)).toEqual([]) // já avisado

    // Reagendar libera um novo aviso
    const task = listTasks(db).find((t) => t.title === 'Bloco 15h')!
    updateTask(db, task.id, { title: task.title, scheduledDate: '2026-10-11', scheduledTime: '16:00' })
    expect(takeBlockReminders(db, at(15, 58), 5).map((t) => t.title)).toEqual(['Bloco 15h'])
  })
})
