import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPrompt, parseResult } from '../../src/shared/ai'
import type { QuestionInput } from '../../src/shared/questions'
import { correctAnswerText, normalizeReviewSettings, reviewCard, reviewRequest, reviewScore } from '../../src/shared/review'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { createNote } from '../../src/main/db/notes'
import { saveTranscript } from '../../src/main/db/media'
import { getSettings, updateSettings } from '../../src/main/db/settings'
import { getReview, reviewSummary, saveReviewAnswers, saveReviewQuestions } from '../../src/main/db/reviews'
import { reviewMaterial } from '../../src/main/ai/source'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

const single: QuestionInput = {
  type: 'single',
  statement: 'Qual comando lista os arquivos de um diretório?',
  options: [
    { id: 'o1', text: 'ls' },
    { id: 'o2', text: 'cd' },
    { id: 'o3', text: 'pwd' }
  ],
  key: { type: 'single', correct: 'o1' },
  explanation: 'O ls lista o conteúdo do diretório.',
  topic: 'Comandos',
  difficulty: 2,
  points: 1
}

const truefalse: QuestionInput = {
  type: 'truefalse',
  statement: 'O kernel é a parte do sistema que fala direto com o hardware.',
  options: [],
  key: { type: 'truefalse', correct: true },
  explanation: '',
  topic: 'Kernel',
  difficulty: 2,
  points: 1
}

describe('revisão pós-aula: regras puras', () => {
  it('configurações inválidas voltam ao padrão', () => {
    expect(normalizeReviewSettings(undefined)).toEqual({ enabled: true, count: 4 })
    expect(normalizeReviewSettings({ enabled: false, count: 5 })).toEqual({ enabled: false, count: 5 })
    expect(normalizeReviewSettings({ enabled: 'sim', count: 9 })).toEqual({ enabled: true, count: 4 })
  })

  it('pede só múltipla escolha e verdadeiro ou falso, sem internet, com as regras de conteúdo', () => {
    const req = reviewRequest('x'.repeat(300), 3)
    expect(req).toMatchObject({ task: 'questions', count: 3, questionTypes: ['single', 'truefalse'], webSearch: false, title: '' })
    const prompt = buildPrompt(req, 'material da aula')
    expect(prompt.user).toContain('Crie 3 questões')
    expect(prompt.user).toContain('revisão rápida')
    expect(prompt.system).toContain('estudar o ASSUNTO, não o vídeo')
    expect(prompt.system).not.toContain('pesquisar na internet')
  })

  it('descarta perguntas sobre o vídeo e tipos fora da revisão', () => {
    const req = reviewRequest('x', 4)
    const answer = JSON.stringify({
      questions: [
        { type: 'single', statement: 'Qual comando lista arquivos?', options: ['ls', 'cd'], correct: [0] },
        { type: 'truefalse', statement: 'No vídeo, o professor usou o comando ls.', answer: true },
        { type: 'short', statement: 'Comando para mudar de diretório?', accepted: ['cd'] }
      ]
    })
    const result = parseResult(req, answer)
    expect(result.task === 'questions' && result.questions.map((q) => q.statement)).toEqual(['Qual comando lista arquivos?'])
  })

  it('conta acertos e monta a carta com a resposta certa e a explicação', () => {
    expect(reviewScore([single, truefalse], [{ type: 'single', choice: 'o1' }, { type: 'truefalse', value: false }])).toBe(1)
    expect(reviewScore([single, truefalse], [null, null])).toBe(0)
    expect(correctAnswerText(single)).toBe('ls')
    expect(reviewCard(single)).toEqual({ front: single.statement, back: 'ls\n\nO ls lista o conteúdo do diretório.' })
    expect(reviewCard(truefalse)).toEqual({ front: `Verdadeiro ou falso? ${truefalse.statement}`, back: 'Verdadeiro' })
  })
})

describe('revisão pós-aula: banco e material', () => {
  let db: Database
  let course: Awaited<ReturnType<typeof makeCourse>>
  const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title LIKE ?').get(`%${title}%`) as { id: number }).id

  beforeEach(async () => {
    course = await makeCourse(['01 Módulo/01 Linux.mp4', '01 Módulo/02 Kernel.mp4', '01 Módulo/03 Resumo.md'])
    await writeFile(join(course.root, '01 Módulo', '03 Resumo.md'), '# Resumo\nTexto do resumo')
    db = openDatabase(':memory:')
    const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
    insertScannedCourse(db, { title: 'DevOps', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
  })

  afterEach(async () => {
    db.close()
    await course.cleanup()
  })

  it('o material é só a fala da aula: sem anotações, título nem curso', async () => {
    const id = lessonId('Linux')
    expect((await reviewMaterial(db, id)).text).toBe('')
    saveTranscript(db, id, { provider: 'groq', model: 'w', language: 'pt', segments: [{ start: 0, end: 2, text: 'o comando ls lista arquivos' }] })
    createNote(db, { lessonId: id, timestampSec: 5, body: 'minha nota secreta' })
    const material = await reviewMaterial(db, id)
    expect(material.kind).toBe('video')
    expect(material.text).toContain('o comando ls lista arquivos')
    expect(material.text).not.toContain('minha nota secreta')
    expect(material.text).not.toContain('Linux')
    expect(material.text).not.toContain('DevOps')
    expect((await reviewMaterial(db, lessonId('Resumo'))).text).toContain('Texto do resumo')
  })

  it('guarda perguntas, respostas parciais e termina com o acerto calculado no banco', () => {
    const id = lessonId('Linux')
    expect(getReview(db, id)).toBeNull()
    const created = saveReviewQuestions(db, id, [single, truefalse], 100)
    expect(created).toMatchObject({ total: 2, correct: null, finishedAt: null, answers: [null, null], createdAt: 100 })

    // Resposta de tipo errado não conta; só uma respondida: ainda não terminou
    const partial = saveReviewAnswers(db, id, [{ type: 'single', choice: 'o2' }, { type: 'single', choice: 'o1' }], 110)
    expect(partial.answers).toEqual([{ type: 'single', choice: 'o2' }, null])
    expect(partial.finishedAt).toBeNull()

    const done = saveReviewAnswers(db, id, [{ type: 'single', choice: 'o2' }, { type: 'truefalse', value: true }], 120)
    expect(done).toMatchObject({ correct: 1, finishedAt: 120 })
    expect(reviewSummary(db, id)).toEqual({ total: 2, correct: 1, createdAt: 100, finishedAt: 120 })

    // Refazer: lista vazia apaga as respostas e mantém as perguntas
    const again = saveReviewAnswers(db, id, [], 130)
    expect(again).toMatchObject({ answers: [null, null], correct: null, finishedAt: null })
    expect(again.questions.map((q) => q.statement)).toEqual([single.statement, truefalse.statement])
  })

  it('perguntas novas substituem a revisão anterior; somem junto com a aula', () => {
    const id = lessonId('Kernel')
    saveReviewQuestions(db, id, [single])
    saveReviewAnswers(db, id, [{ type: 'single', choice: 'o1' }])
    const fresh = saveReviewQuestions(db, id, [truefalse, single], 200)
    expect(fresh).toMatchObject({ total: 2, correct: null, finishedAt: null, answers: [null, null] })
    expect(() => saveReviewQuestions(db, id, [])).toThrow()
    expect(() => saveReviewAnswers(db, lessonId('Linux'), [])).toThrow('não tem revisão')
    db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
    expect(getReview(db, id)).toBeNull()
  })

  it('configurações da revisão passam pela validação', () => {
    expect(getSettings(db).review).toEqual({ enabled: true, count: 4 })
    expect(updateSettings(db, { review: { enabled: false, count: 3 } }).review).toEqual({ enabled: false, count: 3 })
    expect(updateSettings(db, { review: { enabled: true, count: 7 as never } }).review).toEqual({ enabled: true, count: 4 })
  })
})
