import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaJob, MediaJobKind } from '@shared/media'
import type { Database } from '../db/database'
import { lessonOriginalPath } from '../db/lessons'
import { getConversion, saveTranscript, setConversion, usedConversions } from '../db/media'
import { getSettings } from '../db/settings'
import { conversionArgs, probe, runFfmpeg } from './ffmpeg'
import { existsSync } from 'node:fs'
import { GROQ_URL, transcribeMedia } from './transcribe'
import { modelPath, transcribeLocal } from './whisperLocal'

export interface QueueDeps {
  db: Database
  /** Pasta onde ficam as cópias convertidas (dentro dos dados do app). */
  convertedDir: string
  getApiKey: () => string | null
  onChange: (jobs: MediaJob[]) => void
  /** Transcrição embutida: o programa (ou null, se não veio nesta instalação) e a pasta dos modelos. */
  whisper?: { binary: () => string | null; modelsDir: string }
}

/**
 * Fila de conversões e transcrições: uma tarefa por vez (FFmpeg usa a CPU inteira),
 * com progresso e cancelamento. Concluídas ficam na lista até serem dispensadas.
 */
export class MediaQueue {
  private jobs: MediaJob[] = []
  private controllers = new Map<number, AbortController>()
  private nextId = 1
  private running = false

  constructor(private deps: QueueDeps) {}

  list(): MediaJob[] {
    return this.jobs.map((j) => ({ ...j }))
  }

  enqueue(kind: MediaJobKind, lessonId: number): MediaJob {
    const existing = this.jobs.find((j) => j.kind === kind && j.lessonId === lessonId && (j.status === 'queued' || j.status === 'running'))
    if (existing) return existing
    const lesson = this.deps.db.prepare("SELECT title, kind FROM lessons WHERE id = ?").get(lessonId) as { title: string; kind: string } | undefined
    if (!lesson) throw new Error('Aula não encontrada')
    if (lesson.kind !== 'video') throw new Error('Só aulas de vídeo podem ser convertidas ou transcritas')
    if (kind === 'convert' && getConversion(this.deps.db, lessonId)) {
      throw new Error('Esta aula já foi convertida. Remova a conversão para converter de novo.')
    }
    if (kind === 'transcribe') this.transcriberConfig() // valida a configuração antes de entrar na fila
    const job: MediaJob = { id: this.nextId++, kind, lessonId, lessonTitle: lesson.title, status: 'queued', progress: 0, error: null }
    this.jobs.push(job)
    this.emit()
    void this.pump()
    return job
  }

  /** Várias aulas de uma vez (ex.: transcrever o curso inteiro). Devolve quantas entraram na fila. */
  enqueueMany(kind: MediaJobKind, lessonIds: number[]): number {
    if (kind === 'transcribe') this.transcriberConfig()
    const active = new Set(this.jobs.filter((j) => j.kind === kind && (j.status === 'queued' || j.status === 'running')).map((j) => j.lessonId))
    const title = this.deps.db.prepare("SELECT title FROM lessons WHERE id = ? AND kind = 'video'")
    let added = 0
    for (const lessonId of lessonIds) {
      if (active.has(lessonId)) continue
      const lesson = title.get(lessonId) as { title: string } | undefined
      if (!lesson) continue
      this.jobs.push({ id: this.nextId++, kind, lessonId, lessonTitle: lesson.title, status: 'queued', progress: 0, error: null })
      active.add(lessonId)
      added++
    }
    if (added) {
      this.emit()
      void this.pump()
    }
    return added
  }

  /** Cancela tudo o que está na fila e o que está rodando. */
  cancelAll(): void {
    for (const job of this.jobs) {
      if (job.status === 'queued') job.status = 'canceled'
      if (job.status === 'running') this.controllers.get(job.id)?.abort()
    }
    this.emit()
  }

  /** Põe de volta na fila as tarefas que falharam (ex.: limite de uso do provedor). */
  retryFailed(): number {
    let count = 0
    for (const job of this.jobs) {
      if (job.status !== 'error') continue
      job.status = 'queued'
      job.progress = 0
      job.error = null
      count++
    }
    if (count) {
      this.emit()
      void this.pump()
    }
    return count
  }

  cancel(id: number): void {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return
    if (job.status === 'queued') job.status = 'canceled'
    this.controllers.get(id)?.abort()
    this.emit()
  }

  /** Tira da lista as tarefas que já terminaram. */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status === 'queued' || j.status === 'running')
    this.emit()
  }

  private emit() {
    this.deps.onChange(this.list())
  }

  private transcriberConfig() {
    const s = getSettings(this.deps.db)
    if (s.transcriptionProvider === 'none') throw new Error('Configure um provedor de transcrição nas Configurações')
    if (s.transcriptionProvider === 'builtin') {
      const binary = this.deps.whisper?.binary() ?? null
      if (!binary || !this.deps.whisper) throw new Error('A transcrição embutida não está disponível nesta instalação')
      const model = modelPath(this.deps.whisper.modelsDir, s.builtinWhisperModel)
      if (!existsSync(model)) throw new Error('Baixe o modelo de transcrição em Configurações → Vídeo e transcrição')
      return { provider: 'builtin' as const, binary, model, modelId: s.builtinWhisperModel, language: s.transcriptionLanguage }
    }
    if (s.transcriptionProvider === 'groq') {
      const apiKey = this.deps.getApiKey()
      if (!apiKey) throw new Error('Salve a chave de API do Groq nas Configurações')
      return { provider: 'groq' as const, config: { baseUrl: GROQ_URL, apiKey, model: s.transcriptionModel, language: s.transcriptionLanguage } }
    }
    return { provider: 'local' as const, config: { baseUrl: s.localWhisperUrl, apiKey: null, model: s.transcriptionModel, language: s.transcriptionLanguage } }
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.jobs.find((j) => j.status === 'queued'); job; job = this.jobs.find((j) => j.status === 'queued')) {
        const controller = new AbortController()
        this.controllers.set(job.id, controller)
        job.status = 'running'
        this.emit()
        let lastEmit = 0
        const onProgress = (p: number) => {
          job!.progress = p
          // Não inunda a interface: no máximo ~4 atualizações por segundo.
          if (Date.now() - lastEmit > 250) {
            lastEmit = Date.now()
            this.emit()
          }
        }
        try {
          if (job.kind === 'convert') await this.convert(job.lessonId, onProgress, controller.signal)
          else await this.transcribe(job.lessonId, onProgress, controller.signal)
          job.status = 'done'
          job.progress = 1
        } catch (error) {
          job.status = controller.signal.aborted ? 'canceled' : 'error'
          job.error = controller.signal.aborted ? null : error instanceof Error ? error.message : String(error)
        } finally {
          this.controllers.delete(job.id)
          this.emit()
        }
      }
    } finally {
      this.running = false
    }
  }

  /** Converte para uma cópia na pasta do app; os arquivos do curso nunca são alterados. */
  private async convert(lessonId: number, onProgress: (p: number) => void, signal: AbortSignal) {
    const input = lessonOriginalPath(this.deps.db, lessonId)
    const info = await probe(input)
    if (info.compatibility.playable) throw new Error('Este vídeo já é compatível com o player')
    if (info.compatibility.plan === 'none') throw new Error(info.compatibility.reason)
    await mkdir(this.deps.convertedDir, { recursive: true })
    const file = `aula-${lessonId}-${Date.now()}.mp4`
    const partial = join(this.deps.convertedDir, `${file}.parcial`)
    try {
      await runFfmpeg(conversionArgs(input, partial, info.compatibility.plan, getSettings(this.deps.db).conversionArgs), { durationSec: info.durationSec, onProgress, signal })
      await rename(partial, join(this.deps.convertedDir, file))
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
    const previous = getConversion(this.deps.db, lessonId)
    setConversion(this.deps.db, lessonId, file)
    if (previous) await rm(join(this.deps.convertedDir, previous.file), { force: true })
  }

  private async transcribe(lessonId: number, onProgress: (p: number) => void, signal: AbortSignal) {
    const setup = this.transcriberConfig()
    // A cópia convertida, se houver, é mais leve de ler; o áudio é o mesmo.
    const conversion = getConversion(this.deps.db, lessonId)
    const input = conversion ? join(this.deps.convertedDir, conversion.file) : lessonOriginalPath(this.deps.db, lessonId)
    const info = await probe(input)
    if (!info.audioCodec) throw new Error('Este vídeo não tem áudio para transcrever')
    if (setup.provider === 'builtin') {
      const segments = await transcribeLocal(input, { binary: setup.binary, model: setup.model, language: setup.language, durationSec: info.durationSec, onProgress, signal })
      if (segments.length === 0) throw new Error('Nenhuma fala reconhecida neste vídeo')
      saveTranscript(this.deps.db, lessonId, { provider: 'builtin', model: setup.modelId, language: setup.language || 'auto', segments })
      return
    }
    const { provider, config } = setup
    const segments = await transcribeMedia(input, info.durationSec ?? 0, config, { onProgress, signal })
    if (segments.length === 0) throw new Error('Nenhuma fala reconhecida neste vídeo')
    saveTranscript(this.deps.db, lessonId, { provider, model: config.model, language: config.language || 'auto', segments })
  }
}

/** Espaço usado pelas conversões e limpeza das que nenhuma aula usa mais. */
export async function conversionStorage(db: Database, dir: string, clean = false): Promise<{ files: number; bytes: number; removed: number }> {
  const names = await readdir(dir).catch(() => null)
  if (!names) return { files: 0, bytes: 0, removed: 0 }
  const used = usedConversions(db)
  let bytes = 0
  let removed = 0
  for (const name of names) {
    const path = join(dir, name)
    if (clean && !used.has(name)) {
      await rm(path, { force: true })
      removed++
      continue
    }
    bytes += (await stat(path).catch(() => ({ size: 0 }))).size
  }
  return { files: names.length - removed, bytes, removed }
}
