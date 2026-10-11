import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { conversionArgs, probe, runFfmpeg, splitArgs } from '../../src/main/media/ffmpeg'
import { transcribeChunk, transcribeMedia } from '../../src/main/media/transcribe'

let dir: string
/** Vídeo de teste gerado pelo próprio FFmpeg (barras de cor + tom). */
async function makeVideo(name: string, codecArgs: string[], seconds = 3): Promise<string> {
  const out = join(dir, name)
  await runFfmpeg(['-f', 'lavfi', '-i', `testsrc=size=160x90:rate=10:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, ...codecArgs, out])
  return out
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tramotak-ffmpeg-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('FFmpeg embutido', () => {
  it('HEVC é detectado como incompatível e a conversão completa gera H.264 que toca', async () => {
    const hevc = await makeVideo('hevc.mp4', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-c:a', 'aac'])
    const before = await probe(hevc)
    expect(before).toMatchObject({ videoCodec: 'hevc', audioCodec: 'aac', compatibility: { playable: false, plan: 'full' } })
    expect(before.durationSec).toBeCloseTo(3, 0)

    const out = join(dir, 'convertido.mp4')
    const progress: number[] = []
    await runFfmpeg(conversionArgs(hevc, out, 'full', '-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 64k').slice(), { durationSec: before.durationSec, onProgress: (p) => progress.push(p) })
    expect(await probe(out)).toMatchObject({ videoCodec: 'h264', audioCodec: 'aac', compatibility: { playable: true } })
    expect(progress.at(-1)).toBeGreaterThan(0.9)
  }, 60_000)

  it('H.264 em AVI só troca o contêiner (sem recodificar)', async () => {
    const avi = await makeVideo('velho.avi', ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'libmp3lame'])
    const info = await probe(avi)
    expect(info.compatibility.plan).toBe('remux')
    const out = join(dir, 'remux.mp4')
    await runFfmpeg(conversionArgs(avi, out, 'remux'))
    expect(await probe(out)).toMatchObject({ videoCodec: 'h264', audioCodec: 'mp3', compatibility: { playable: true } })
  }, 60_000)

  it('cancelamento interrompe o processo; arquivo corrompido dá erro claro', async () => {
    const controller = new AbortController()
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=600', '-c:v', 'libx264', '-preset', 'veryslow', join(dir, 'longo.mp4')], { signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    await expect(run).rejects.toThrow('Cancelado')

    const junk = join(dir, 'lixo.mp4')
    await (await import('node:fs/promises')).writeFile(junk, 'isto não é um vídeo')
    await expect(probe(junk)).rejects.toThrow('ilegível')
  }, 60_000)

  it('argumentos digitados respeitam aspas e não passam por shell', () => {
    expect(splitArgs('-c:v libx264 -vf "scale=1280:-2" -metadata title=\'Minha aula\'')).toEqual(['-c:v', 'libx264', '-vf', 'scale=1280:-2', '-metadata', 'title=Minha aula'])
  })
})

describe('transcrição (servidor falso compatível com a API da OpenAI)', () => {
  let server: Server
  let baseUrl: string
  const requests: { auth: string | undefined; fields: string; bytes: number }[] = []
  let status = 200

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = Buffer.concat(chunks)
      requests.push({ auth: req.headers.authorization, fields: body.toString('latin1'), bytes: body.length })
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(status === 200 ? JSON.stringify({ segments: [{ start: 0.2, end: 1.1, text: ` trecho ${requests.length} ` }] }) : JSON.stringify({ error: { message: 'chave errada' } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('divide em pedaços, envia modelo e idioma e junta os horários em sequência', async () => {
    const video = await makeVideo('fala.mp4', ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'], 5)
    const progress: number[] = []
    const segments = await transcribeMedia(video, 5, { baseUrl, apiKey: 'segredo', model: 'whisper-large-v3-turbo', language: 'pt' }, { chunkSec: 2, onProgress: (p) => progress.push(p) })
    expect(segments).toEqual([
      { start: 0.2, end: 1.1, text: 'trecho 1' },
      { start: 2.2, end: 3.1, text: 'trecho 2' },
      { start: 4.2, end: 5.1, text: 'trecho 3' }
    ])
    expect(progress).toEqual([1 / 3, 2 / 3, 1])
    expect(requests[0].auth).toBe('Bearer segredo')
    expect(requests[0].fields).toContain('whisper-large-v3-turbo')
    expect(requests[0].fields).toContain('verbose_json')
    expect(requests[0].fields).toMatch(/name="language"\r\n\r\npt/)
    expect(requests[0].bytes).toBeGreaterThan(1000) // havia áudio de verdade no envio
  }, 60_000)

  it('erros do provedor viram mensagens claras', async () => {
    status = 401
    const audio = join(dir, 'a.mp3')
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=duration=1', audio])
    await expect(transcribeChunk(audio, { baseUrl, apiKey: 'x', model: 'm', language: '' })).rejects.toThrow('recusou a chave')
    status = 200
    await expect(transcribeChunk(audio, { baseUrl: 'http://127.0.0.1:1/v1', apiKey: null, model: 'm', language: '' })).rejects.toThrow('Não foi possível conectar a 127.0.0.1:1')
  })
})
