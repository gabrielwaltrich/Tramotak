import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWhisperJson, whisperProgress, WHISPER_MODEL_URL, WHISPER_MODELS, type TranscriptSegment, type WhisperModelId } from '@shared/media'
import { runFfmpeg } from './ffmpeg'

/**
 * Onde está o whisper-cli: no app instalado, em `resources/whisper`; em desenvolvimento, em `build/whisper`
 * (compilado por scripts/build-whisper.sh). `null` se esta instalação não trouxer o programa.
 */
export function whisperBinary(resourcesPath: string, appPath: string): string | null {
  const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  for (const dir of [join(resourcesPath, 'whisper'), join(appPath, 'build', 'whisper')]) {
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  return null
}

export function modelInfo(id: WhisperModelId) {
  const model = WHISPER_MODELS.find((m) => m.id === id)
  if (!model) throw new Error('Modelo de transcrição desconhecido')
  return model
}

export function modelPath(modelsDir: string, id: WhisperModelId): string {
  return join(modelsDir, modelInfo(id).file)
}

/** Modelos já baixados (conferidos pelo tamanho). */
export async function installedModels(modelsDir: string): Promise<WhisperModelId[]> {
  const out: WhisperModelId[] = []
  for (const m of WHISPER_MODELS) {
    const info = await stat(join(modelsDir, m.file)).catch(() => null)
    if (info?.size === m.bytes) out.push(m.id)
  }
  return out
}

/** Baixa um modelo para `.parcial`, confere tamanho e SHA-256 e só então dá o nome final. */
export async function downloadModel(
  modelsDir: string,
  id: WhisperModelId,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  /** Para testes: tamanho e hash esperados (por padrão, os do catálogo). */
  expected?: { bytes: number; sha256: string }
): Promise<void> {
  const model = { ...modelInfo(id), ...expected }
  await mkdir(modelsDir, { recursive: true })
  const partial = join(modelsDir, `${model.file}.parcial`)
  let response: Response
  try {
    response = await fetchImpl(WHISPER_MODEL_URL(model.file), { signal })
  } catch (error) {
    if (signal.aborted) throw new Error('Cancelado', { cause: error })
    throw new Error('Não foi possível baixar o modelo. Confira a internet.', { cause: error })
  }
  if (!response.ok || !response.body) throw new Error(`O download do modelo falhou (${response.status})`)
  const hash = createHash('sha256')
  const out = createWriteStream(partial)
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      onProgress(Math.min(1, received / model.bytes))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
    if (received !== model.bytes || hash.digest('hex') !== model.sha256) throw new Error('O arquivo do modelo veio corrompido. Tente de novo.')
    await rename(partial, join(modelsDir, model.file))
  } catch (error) {
    out.destroy()
    await rm(partial, { force: true })
    if (signal.aborted) throw new Error('Cancelado', { cause: error })
    throw error
  }
}

export interface LocalTranscribeOptions {
  binary: string
  model: string
  /** Código ISO ("pt") ou vazio para detectar. */
  language: string
  durationSec: number | null
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Transcreve no próprio computador: extrai o áudio (16 kHz mono) com o FFmpeg e roda o whisper-cli. */
export async function transcribeLocal(input: string, options: LocalTranscribeOptions): Promise<TranscriptSegment[]> {
  const dir = await mkdtemp(join(tmpdir(), 'tramotak-whisper-'))
  const wav = join(dir, 'audio.wav')
  const out = join(dir, 'resultado')
  const report = (f: number) => options.onProgress?.(f)
  try {
    // Extrair o áudio é rápido: 5% da barra; o resto é o reconhecimento.
    await runFfmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], {
      durationSec: options.durationSec,
      onProgress: (p) => report(p * 0.05),
      signal: options.signal
    })
    const threads = String(Math.max(1, Math.min(8, cpus().length - 1)))
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.binary, ['-m', options.model, '-f', wav, '-l', options.language || 'auto', '-t', threads, '-oj', '-of', out, '-pp'], {
        windowsHide: true
      })
      let tail = ''
      const onAbort = () => child.kill()
      options.signal?.addEventListener('abort', onAbort)
      const read = (chunk: Buffer) => {
        const text = chunk.toString()
        tail = (tail + text).slice(-2000)
        for (const line of text.split(/\r?\n/)) {
          const p = whisperProgress(line)
          if (p !== null) report(0.05 + p * 0.95)
        }
      }
      child.stderr.on('data', read)
      child.stdout.on('data', read)
      child.on('error', (error) => reject(new Error(`Não foi possível iniciar a transcrição embutida: ${error.message}`)))
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', onAbort)
        if (options.signal?.aborted) return reject(new Error('Cancelado'))
        if (code === 0) return resolve()
        const reason = /failed to load model|invalid model/i.test(tail) ? 'o arquivo do modelo está inválido; baixe de novo' : `código ${code}`
        reject(new Error(`A transcrição embutida falhou (${reason})`))
      })
    })
    return parseWhisperJson(JSON.parse(await readFile(`${out}.json`, 'utf8')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
