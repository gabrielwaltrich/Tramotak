import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { sep } from 'node:path'
import { compatibility, parseProbe, progressFrom, type Compatibility, type ConversionPlan, type ProbeResult } from '@shared/media'

const require = createRequire(__filename)

import { DEFAULT_CONVERSION_ARGS } from '../db/settings'

export { DEFAULT_CONVERSION_ARGS }

/** Caminho do FFmpeg embutido (ffmpeg-static). No app empacotado, o binário fica fora do asar. */
export function ffmpegPath(): string {
  const path = process.env.TRAMOTAK_FFMPEG || (require('ffmpeg-static') as string | null)
  if (!path) throw new Error('FFmpeg não disponível para este sistema')
  return path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

interface RunOptions {
  durationSec?: number | null
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Roda o FFmpeg sem shell (argumentos em lista), com progresso e cancelamento. */
export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Cancelado'))
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true })
    let stderr = ''
    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const p = progressFrom(line, options.durationSec ?? null)
        if (p !== null) options.onProgress?.(p)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000)
    })
    const onAbort = () => child.kill('SIGKILL')
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) return reject(new Error('Cancelado'))
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg falhou: ${stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `código ${code}`}`))
    })
  })
}

/** Lê duração, contêiner e codecs com `ffmpeg -i` (que termina com erro de propósito: não há saída). */
export function probe(file: string, timeoutMs = 20_000): Promise<ProbeResult & { compatibility: Compatibility }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true })
    let stderr = ''
    // Arquivo em disco lento ou travado não pode segurar a fila para sempre.
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (/No such file|Invalid data found|could not find codec/i.test(stderr) && !/Stream #/.test(stderr)) {
        return reject(new Error('Arquivo de vídeo ilegível ou corrompido'))
      }
      const info = parseProbe(stderr)
      resolve({ ...info, compatibility: compatibility(info) })
    })
  })
}

/** Divide argumentos digitados pelo usuário respeitando aspas. Nada passa por shell. */
export function splitArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
    } else if (/\s/.test(ch)) {
      if (inToken) args.push(current)
      current = ''
      inToken = false
    } else {
      current += ch
      inToken = true
    }
  }
  if (inToken) args.push(current)
  return args
}

/** Argumentos para gerar um MP4 que o player toca, do jeito mais barato possível. */
export function conversionArgs(input: string, output: string, plan: ConversionPlan, fullArgs = DEFAULT_CONVERSION_ARGS): string[] {
  // Só a primeira faixa de vídeo e de áudio: legendas e dados embutidos costumam quebrar o MP4.
  const base = ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn']
  const codec =
    plan === 'remux' ? ['-c', 'copy']
    : plan === 'audio' ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k']
    : splitArgs(fullArgs)
  return [...base, ...codec, '-movflags', '+faststart', '-f', 'mp4', output]
}

/** Áudio leve (mono, 16 kHz, 32 kb/s) para enviar à transcrição: ~14 MB por hora. */
export function extractAudio(input: string, output: string, startSec: number, durationSec: number, signal?: AbortSignal): Promise<void> {
  return runFfmpeg(['-ss', String(startSec), '-t', String(durationSec), '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'mp3', output], { signal })
}
