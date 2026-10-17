import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTransientAiError, planCounts, type CourseGenerateProgress } from '../../src/shared/courseGenerate'
import { openDatabase, type Database } from '../../src/main/db/database'
import { getCourseDetail, insertScannedCourse } from '../../src/main/db/courses'
import { saveTranscript } from '../../src/main/db/media'
import { createCard, createDeck, getDeck } from '../../src/main/db/flashcards'
import { listQuestions } from '../../src/main/db/questions'
import { courseMaterialSummary, lessonMaterialText, runCourseGeneration, scopeLessons } from '../../src/main/ai/courseGenerate'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

describe('gerar do curso: regras puras', () => {
  it('quantidade por aula até o teto, pulando aulas sem material suficiente', () => {
    const lessons = [{ id: 1, chars: 5000 }, { id: 2, chars: 50 }, { id: 3, chars: 900 }, { id: 4, chars: 3000 }]
    expect(planCounts(lessons, 3, 100).map((l) => [l.id, l.count])).toEqual([[1, 3], [3, 3], [4, 3]])
    expect(planCounts(lessons, 3, 4).map((l) => [l.id, l.count])).toEqual([[1, 3], [3, 1]])
    expect(isTransientAiError('Gemini: limite de uso atingido. Tente de novo mais tarde.')).toBe(true)
    expect(isTransientAiError('Gemini recusou a chave de API.')).toBe(false)
  })
})

describe('gerar do curso: aula por aula, salvando direto', () => {
  let db: Database
  let course: Awaited<ReturnType<typeof makeCourse>>
  let courseId: number
  let server: Server
  let url: string
  let respond: (prompt: string, n: number) => { status?: number; body: unknown }
  const prompts: string[] = []
  const lesson = (t: string) => (db.prepare('SELECT id FROM lessons WHERE title LIKE ?').get(`%${t}%`) as { id: number }).id
  const fala = (text: string) => [{ start: 0, end: 5, text: `${text} `.repeat(30) }]
  const config = () => ({ provider: 'ollama' as const, model: 'm', apiKey: null, baseUrl: url })

  beforeEach(async () => {
    course = await makeCourse(['01 Linux/01 Kernel.mp4', '01 Linux/02 Processos.mp4', '02 Docker/01 Imagens.mp4', '02 Docker/02 Vazia.mp4'])
    db = openDatabase(':memory:')
    courseId = insertScannedCourse(db, { title: 'DevOps PRO', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, await scanCourse(course.root, { structure: 'auto', numbering: 'dot' }))
    saveTranscript(db, lesson('Kernel'), { provider: 'groq', model: 'w', language: 'pt', segments: fala('O kernel gerencia a memória.') })
    saveTranscript(db, lesson('Processos'), { provider: 'groq', model: 'w', language: 'pt', segments: fala('Processos têm PID.') })
    saveTranscript(db, lesson('Imagens'), { provider: 'groq', model: 'w', language: 'pt', segments: fala('Imagens têm camadas.') })
    prompts.length = 0
    let n = 0
    respond = (_p, i) => ({ body: { cards: [{ front: `Pergunta ${i}?`, back: 'R' }, { front: 'Repetida?', back: 'R' }, { front: 'No vídeo, o professor disse o quê?', back: 'x' }] } })
    server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const data = JSON.parse(body)
      const prompt = data.messages.at(-1).content as string
      prompts.push(prompt)
      const r = respond(prompt, ++n)
      res.statusCode = r.status ?? 200
      res.setHeader('content-type', 'application/json')
      res.end(r.status ? JSON.stringify({ error: 'falhou' }) : JSON.stringify({ message: { content: JSON.stringify(r.body) } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterEach(async () => {
    server.close()
    db.close()
    await course.cleanup()
  })

  const run = (input: Partial<Parameters<typeof runCourseGeneration>[0]>, signal = new AbortController().signal) => {
    const events: CourseGenerateProgress[] = []
    return runCourseGeneration(
      { courseId, task: 'cards', moduleIds: [], perLesson: 2, maxTotal: 100, questionTypes: [], instructions: '', targetId: null, newTitle: '', ...input },
      { db, provider: 'ollama', config: config(), signal, onProgress: (p) => events.push(p), retryDelayMs: 1 }
    ).then((final) => ({ final, events }))
  }

  it('escopo por módulos e resumo do material; o material da aula vai sem título', async () => {
    const detail = getCourseDetail(db, courseId)
    const docker = detail.modules.find((m) => m.title.includes('Docker'))!.id
    expect(scopeLessons(detail, [docker])).toEqual([lesson('Imagens'), lesson('Vazia')])
    expect(scopeLessons(detail, [])).toHaveLength(4)
    const summary = await courseMaterialSummary(db, courseId, [docker])
    expect(summary).toMatchObject({ lessons: 1, total: 2 })
    expect(summary.modules.map((m) => [m.lessons, m.withMaterial])).toEqual([[2, 2], [2, 1]])
    const text = lessonMaterialText(db, lesson('Kernel'))
    expect(text.startsWith('## Transcrição automática da fala\nO kernel')).toBe(true)
    expect(text).not.toContain('Kernel.mp4')
  })

  it('gera aula por aula, liga a carta à aula, respeita a quantidade e descarta repetidas e sobre o vídeo', async () => {
    const deck = createDeck(db, { title: 'Meu baralho', courseId })
    createCard(db, { deckId: deck, front: 'Repetida?', back: 'já existia' })
    const { final, events } = await run({ targetId: deck, perLesson: 2, maxTotal: 3 })
    expect(final).toMatchObject({ finished: true, canceled: false, error: null, total: 2, done: 2, saved: 2, targetId: deck, targetTitle: 'Meu baralho' })
    // 1ª aula: única + repetida (descartada) + sobre o vídeo (descartada); 2ª aula: só 1 (o teto)
    expect(final.discarded).toBe(4)
    expect(events[0]).toMatchObject({ done: 0, total: 2 })
    const cards = getDeck(db, deck).cards.map((c) => [c.front, c.lessonId])
    expect(cards).toEqual([
      ['Repetida?', null],
      ['Pergunta 1?', lesson('Kernel')],
      ['Pergunta 2?', lesson('Processos')]
    ])
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Crie 2 flashcards')
    expect(prompts[1]).toContain('Crie 1 flashcards')
    expect(prompts.join('\n')).not.toMatch(/DevOps PRO|Kernel\.mp4|01 Linux/)
  })

  it('questões num banco novo com o nome do curso', async () => {
    respond = (_p, i) => ({ body: { questions: [{ type: 'truefalse', statement: `Afirmação ${i} sobre o assunto.`, answer: true }] } })
    const { final } = await run({ task: 'questions', questionTypes: ['truefalse'], perLesson: 1 })
    expect(final).toMatchObject({ saved: 3, targetTitle: 'DevOps PRO — questões da IA' })
    expect(listQuestions(db, final.targetId!).map((q) => q.statement)).toEqual(['Afirmação 1 sobre o assunto.', 'Afirmação 2 sobre o assunto.', 'Afirmação 3 sobre o assunto.'])
  })

  it('limite de uso: espera e tenta de novo; erros seguidos param tudo', async () => {
    respond = (_p, i) => (i === 1 ? { status: 429, body: null } : { body: { cards: [{ front: `P${i}?`, back: 'R' }] } })
    const ok = await run({ perLesson: 1 })
    expect(ok.final).toMatchObject({ saved: 3, failed: 0 })

    respond = () => ({ status: 401, body: null })
    const bad = await run({ perLesson: 1, targetId: ok.final.targetId })
    expect(bad.final).toMatchObject({ saved: 0, failed: 3, done: 2 })
    expect(bad.final.error).toMatch(/3 aulas seguidas com erro: .*chave/)
  })

  it('interromper mantém o que já foi salvo; sem material, nem começa', async () => {
    const controller = new AbortController()
    respond = (_p, i) => {
      if (i === 2) controller.abort()
      return { body: { cards: [{ front: `P${i}?`, back: 'R' }] } }
    }
    const { final } = await run({ perLesson: 1 }, controller.signal)
    expect(final).toMatchObject({ canceled: true, finished: true })
    expect(final.saved).toBe(1)

    const detail = getCourseDetail(db, courseId)
    const empty = detail.modules.find((m) => m.title.includes('Docker'))!
    db.prepare('DELETE FROM transcripts WHERE lesson_id = ?').run(lesson('Imagens'))
    await expect(run({ moduleIds: [empty.id] })).rejects.toThrow('Nenhuma aula escolhida')
  })
})
