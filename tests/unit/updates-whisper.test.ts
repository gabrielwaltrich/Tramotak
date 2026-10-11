import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVersions } from '@shared/updates'
import { parseWhisperJson, whisperProgress, WHISPER_MODELS } from '@shared/media'
import { downloadModel, installedModels } from '../../src/main/media/whisperLocal'

describe('versões', () => {
  it('compara números de versão', () => {
    expect(compareVersions('0.5.0', '0.4.3')).toBeGreaterThan(0)
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('0.4.2', '0.4.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0)
  })
})

describe('whisper embutido: leitura do resultado', () => {
  it('converte o JSON do whisper-cli em trechos com horário e descarta marcadores sem fala', () => {
    const json = {
      transcription: [
        { offsets: { from: 0, to: 2500 }, text: ' Olá, turma.' },
        { offsets: { from: 2500, to: 4000 }, text: ' [Música]' },
        { offsets: { from: 4000, to: 6200 }, text: ' Hoje: limites.' }
      ]
    }
    expect(parseWhisperJson(json)).toEqual([
      { start: 0, end: 2.5, text: 'Olá, turma.' },
      { start: 4, end: 6.2, text: 'Hoje: limites.' }
    ])
    expect(() => parseWhisperJson({ algo: 1 })).toThrow(/formato inesperado/)
  })

  it('lê o progresso impresso pelo -pp', () => {
    expect(whisperProgress('whisper_print_progress_callback: progress =  42%')).toBe(0.42)
    expect(whisperProgress('outra linha')).toBeNull()
  })

  it('o catálogo traz tamanho e SHA-256 de cada modelo', () => {
    for (const m of WHISPER_MODELS) {
      expect(m.bytes).toBeGreaterThan(1_000_000)
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('whisper embutido: download de modelos', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tramotak-models-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const stream = (chunks: Uint8Array[]) =>
    (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const x of chunks) c.enqueue(x)
            c.close()
          }
        })
      )) as unknown as typeof fetch

  it('baixa em partes, confere tamanho e hash e só então grava com o nome final', async () => {
    const content = new TextEncoder().encode('modelo de teste '.repeat(1000))
    const sha256 = createHash('sha256').update(content).digest('hex')
    const progress: number[] = []
    await downloadModel(dir, 'base-q5_1', (f) => progress.push(f), new AbortController().signal, stream([content.slice(0, 5000), content.slice(5000)]), { bytes: content.length, sha256 })
    expect(await readFile(join(dir, 'ggml-base-q5_1.bin'))).toEqual(Buffer.from(content))
    expect(progress.at(-1)).toBe(1)
    expect(await readdir(dir)).toEqual(['ggml-base-q5_1.bin'])
  })

  it('arquivo corrompido é recusado e não deixa sobra', async () => {
    const content = new TextEncoder().encode('conteúdo errado')
    await expect(
      downloadModel(dir, 'base-q5_1', () => undefined, new AbortController().signal, stream([content]), { bytes: content.length, sha256: 'a'.repeat(64) })
    ).rejects.toThrow(/corrompido/)
    expect(await readdir(dir)).toEqual([])
  })

  it('modelos instalados são conferidos pelo tamanho', async () => {
    expect(await installedModels(dir)).toEqual([])
    expect(existsSync(join(dir, 'x'))).toBe(false)
  })
})
