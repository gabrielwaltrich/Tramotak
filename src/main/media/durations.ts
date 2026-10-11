import type { Database } from '../db/database'
import { lessonOriginalPath, setDuration } from '../db/lessons'

export interface DurationUpdate {
  courseId: number
  /** Durações lidas até agora nesta passada. */
  filled: number
  /** Aulas de vídeo do curso que ainda estão sem duração. */
  remaining: number
  done: boolean
}

export interface DurationScannerOptions {
  db: Database
  /** Lê a duração de um arquivo (o FFmpeg, no app); `null` se não conseguir. */
  readDuration: (file: string) => Promise<number | null>
  onUpdate: (update: DurationUpdate) => void
  concurrency?: number
  /** Intervalo mínimo entre avisos de progresso para a interface. */
  notifyEveryMs?: number
}

/**
 * Preenche em segundo plano a duração das aulas de vídeo, no processo principal: não depende da tela
 * aberta, lê vários arquivos ao mesmo tempo e avisa a interface aos poucos. Arquivos que falham não são
 * tentados de novo até o app reiniciar.
 */
export class DurationScanner {
  private readonly pending = new Set<number>()
  private readonly failed = new Set<number>()
  private running: Promise<void> | null = null

  constructor(private readonly options: DurationScannerOptions) {}

  /** Agenda um curso (repetir o pedido não duplica o trabalho). */
  request(courseId: number): Promise<void> {
    this.pending.add(courseId)
    return this.start()
  }

  /** Agenda todos os cursos que têm aulas sem duração. */
  requestAll(): Promise<void> {
    const rows = this.options.db
      .prepare("SELECT DISTINCT course_id AS id FROM lessons WHERE kind = 'video' AND duration_sec IS NULL")
      .all() as { id: number }[]
    for (const r of rows) this.pending.add(r.id)
    return this.start()
  }

  private start(): Promise<void> {
    if (!this.running) {
      this.running = (async () => {
        try {
          while (this.pending.size) {
            const [courseId] = this.pending
            this.pending.delete(courseId)
            await this.fill(courseId)
          }
        } finally {
          this.running = null
        }
      })()
    }
    return this.running
  }

  private missing(courseId: number): number[] {
    return (
      this.options.db
        .prepare("SELECT id FROM lessons WHERE course_id = ? AND kind = 'video' AND duration_sec IS NULL ORDER BY module_id IS NOT NULL, module_id, position")
        .all(courseId) as { id: number }[]
    )
      .map((r) => r.id)
      .filter((id) => !this.failed.has(id))
  }

  private async fill(courseId: number): Promise<void> {
    const { db, readDuration, onUpdate, concurrency = 4, notifyEveryMs = 1000 } = this.options
    const queue = this.missing(courseId)
    if (!queue.length) return
    let filled = 0
    let lastNotice = Date.now()
    const notify = (done: boolean) => {
      const remaining = (db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE course_id = ? AND kind = 'video' AND duration_sec IS NULL").get(courseId) as { n: number }).n
      onUpdate({ courseId, filled, remaining, done })
    }

    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const duration = await Promise.resolve()
          .then(() => readDuration(lessonOriginalPath(db, id)))
          .catch(() => null)
        // A aula pode ter sido removida enquanto o arquivo era lido.
        if (duration && duration > 0 && db.prepare('SELECT 1 FROM lessons WHERE id = ?').get(id)) {
          setDuration(db, id, duration)
          filled++
        } else {
          this.failed.add(id)
        }
        if (Date.now() - lastNotice >= notifyEveryMs) {
          lastNotice = Date.now()
          notify(false)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    notify(true)
  }
}
