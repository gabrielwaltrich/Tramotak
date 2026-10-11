import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MediaJob } from '@shared/media'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse, revalidateCourse } from '../../src/main/db/courses'
import { getLessonView, lessonFilePath } from '../../src/main/db/lessons'
import { getConversion, getTranscript } from '../../src/main/db/media'
import { search } from '../../src/main/db/search'
import { updateSettings } from '../../src/main/db/settings'
import { probe, runFfmpeg } from '../../src/main/media/ffmpeg'
import { conversionStorage, MediaQueue } from '../../src/main/media/jobs'
import { scanCourse } from '../../src/main/scanner/scan'

let dir: string
let courseDir: string
let convertedDir: string
let db: Database
let lessonId: number
let server: Server
let whisperUrl: string

const waitFor = (queue: MediaQueue, id: number) =>
  new Promise<MediaJob>((resolve) => {
    const check = () => {
      const job = queue.list().find((j) => j.id === id)!
      if (['done', 'error', 'canceled'].includes(job.status)) resolve(job)
      else setTimeout(check, 50)
    }
    check()
  })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tramotak-queue-'))
  courseDir = join(dir, 'Curso')
  convertedDir = join(dir, 'converted')
  await (await import('node:fs/promises')).mkdir(join(courseDir, '1. Módulo'), { recursive: true })
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-c:a', 'aac', join(courseDir, '1. Módulo', '1. Aula HEVC.mp4')])
  db = openDatabase(':memory:')
  const scan = await scanCourse(courseDir, { structure: 'auto', numbering: 'dot' })
  insertScannedCourse(db, { title: 'Curso', rootPath: courseDir, numbering: 'dot', scanStructure: 'auto' }, scan)
  lessonId = (db.prepare('SELECT id FROM lessons').get() as { id: number }).id

  server = createServer(async (req, res) => {
    for await (const _ of req) void _
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ segments: [{ start: 0.5, end: 2, text: 'Hoje vamos estudar a regra de três' }] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  whisperUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}, 60_000)

afterAll(async () => {
  db.close()
  await new Promise<void>((r) => server.close(() => r()))
  await rm(dir, { recursive: true, force: true })
})

describe('fila de mídia', () => {
  it('converte para uma cópia na pasta do app; o original não é tocado', async () => {
    const original = join(courseDir, '1. Módulo', '1. Aula HEVC.mp4')
    const before = await readFile(original)
    const changes: MediaJob[][] = []
    const queue = new MediaQueue({ db, convertedDir, getApiKey: () => null, onChange: (j) => changes.push(j) })
    updateSettings(db, { conversionArgs: '-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 64k' })

    const job = await waitFor(queue, queue.enqueue('convert', lessonId).id)
    expect(job).toMatchObject({ status: 'done', progress: 1, error: null })
    expect(changes.some((list) => list[0]?.status === 'running')).toBe(true)

    const conversion = getConversion(db, lessonId)!
    expect(lessonFilePath(db, lessonId, convertedDir)).toBe(join(convertedDir, conversion.file))
    expect(lessonFilePath(db, lessonId)).toBe(original)
    expect(await probe(join(convertedDir, conversion.file))).toMatchObject({ videoCodec: 'h264', compatibility: { playable: true } })
    expect((await readFile(original)).equals(before)).toBe(true)
    expect(getLessonView(db, lessonId)).toMatchObject({ converted: true, url: `tramotak-media://lesson/${lessonId}?v=${conversion.at}` })
    expect((await readdir(convertedDir)).filter((f) => f.endsWith('.parcial'))).toEqual([])

    // Converter de novo é recusado com mensagem clara (para refazer, remove-se a conversão)
    expect(() => queue.enqueue('convert', lessonId)).toThrow('já foi convertida')
  }, 120_000)

  it('transcreve, guarda a legenda e o texto falado entra na busca da aula', async () => {
    const queue = new MediaQueue({ db, convertedDir, getApiKey: () => null, onChange: () => {} })
    expect(() => queue.enqueue('transcribe', lessonId)).toThrow('Configure um provedor')
    updateSettings(db, { transcriptionProvider: 'local', localWhisperUrl: whisperUrl, transcriptionModel: 'whisper-1' })

    const job = await waitFor(queue, queue.enqueue('transcribe', lessonId).id)
    expect(job).toMatchObject({ status: 'done' })
    expect(getTranscript(db, lessonId)).toMatchObject({ provider: 'local', model: 'whisper-1', language: 'pt', segments: [{ start: 0.5, end: 2, text: 'Hoje vamos estudar a regra de três' }] })
    expect(getLessonView(db, lessonId).transcriptUrl).toMatch(/^tramotak-media:\/\/transcript\/\d+\?v=\d+$/)
    expect(search(db, 'regra de tres')).toEqual([expect.objectContaining({ kind: 'lesson', id: lessonId })])

    updateSettings(db, { transcriptionProvider: 'groq' })
    expect(() => queue.enqueue('transcribe', lessonId)).toThrow('chave de API do Groq')
  }, 60_000)

  it('cancelar uma conversão em andamento não deixa arquivo pela metade', async () => {
    const db2 = openDatabase(':memory:')
    const scan = await scanCourse(courseDir, { structure: 'auto', numbering: 'dot' })
    insertScannedCourse(db2, { title: 'C2', rootPath: courseDir, numbering: 'dot', scanStructure: 'auto' }, scan)
    const id = (db2.prepare('SELECT id FROM lessons').get() as { id: number }).id
    updateSettings(db2, { conversionArgs: '-vf scale=3840:2160 -c:v libx264 -preset placebo -c:a aac' }) // lento de propósito
    const queue = new MediaQueue({ db: db2, convertedDir, getApiKey: () => null, onChange: () => {} })
    const job = queue.enqueue('convert', id)
    setTimeout(() => queue.cancel(job.id), 300)
    expect((await waitFor(queue, job.id)).status).toBe('canceled')
    expect((await readdir(convertedDir)).filter((f) => f.endsWith('.parcial'))).toEqual([])
    expect(getConversion(db2, id)).toBeNull()
    db2.close()
  }, 60_000)

  it('revalidar com o arquivo alterado descarta a conversão; limpeza apaga cópias órfãs', async () => {
    expect(getConversion(db, lessonId)).not.toBeNull()
    const original = join(courseDir, '1. Módulo', '1. Aula HEVC.mp4')
    const { utimes } = await import('node:fs/promises')
    await utimes(original, new Date(), new Date(Date.now() + 5000))
    revalidateCourse(db, (db.prepare('SELECT id FROM courses').get() as { id: number }).id, await scanCourse(courseDir, { structure: 'auto', numbering: 'dot' }))
    expect(getConversion(db, lessonId)).toBeNull()

    const result = await conversionStorage(db, convertedDir, true)
    expect(result.removed).toBeGreaterThan(0)
    expect(await readdir(convertedDir)).toEqual([])
  }, 60_000)
})

describe('configurações de mídia', () => {
  it('validam parâmetros, provedor, idioma e URL', () => {
    const d = openDatabase(':memory:')
    expect(() => updateSettings(d, { conversionArgs: '-i /etc/passwd -c copy' })).toThrow('-i, -y ou -n')
    expect(() => updateSettings(d, { transcriptionProvider: 'openai' as never })).toThrow('Provedor')
    expect(() => updateSettings(d, { transcriptionLanguage: 'português' })).toThrow('Idioma')
    expect(updateSettings(d, { transcriptionLanguage: '' }).transcriptionLanguage).toBe('')
    expect(() => updateSettings(d, { localWhisperUrl: 'ftp://x' })).toThrow('URL')
    expect(updateSettings(d, { localWhisperUrl: 'http://192.168.0.10:9000/v1/' }).localWhisperUrl).toBe('http://192.168.0.10:9000/v1')
    d.close()
  })
})
