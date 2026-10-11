import { gunzipSync, gzipSync } from 'node:zlib'
import {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  type ExportCatalog,
  type ExportSelection,
  type PackageImportResult,
  type PackagePreview
} from '@shared/backup'
import type { Block } from '@shared/notebooks'
import { validateBlocks } from '@shared/notebooks'
import type { MindMapData } from '@shared/mindmap'
import { validateMap } from '@shared/mindmap'
import { validateQuestion, type QuestionInput } from '@shared/questions'
import type { ExamSelection, ExamSettings } from '@shared/exams'
import type { TranscriptSegment } from '@shared/media'
import { normalize } from '@shared/search'
import { transaction, type Database } from '../db/database'
import { createCard, createDeck } from '../db/flashcards'
import { createBank, createExam, createQuestion } from '../db/questions'
import { createNotebook, createPage, savePage } from '../db/notebooks'
import { createMindMap } from '../db/mindmaps'
import { createNote } from '../db/notes'
import { getTranscript, saveTranscript } from '../db/media'

// ── Formato ─────────────────────────────────────────────────────────────────

/** Ligação a um curso (relPath nulo) ou a uma aula, independente dos ids e das pastas do computador. */
export interface LessonRef {
  course: string
  relPath: string | null
}

type ItemRef = LessonRef | { deck: string } | { bank: string }

export interface PkgCourse {
  key: string
  title: string
  /** Caminhos relativos das aulas: servem para achar o curso correspondente no outro computador. */
  lessons: string[]
  /** Só referenciado por outro item (sem anotações/progresso próprios no pacote). */
  withData: boolean
  notes: { relPath: string; timestampSec: number | null; body: string; createdAt: number }[]
  progress: { relPath: string; positionSec: number; durationSec: number | null; completedAt: number | null; favorite: boolean; lastWatchedAt: number | null }[]
  transcripts: { relPath: string; provider: string; model: string; language: string; segments: TranscriptSegment[] }[]
}

interface PkgSchedule {
  state: string
  step: number
  intervalDays: number
  ease: number
  due: number
  reps: number
  lapses: number
  lastReviewAt: number | null
}

export interface PkgDeck {
  key: string
  title: string
  description: string
  course: string | null
  cards: { front: string; back: string; ref: LessonRef | null; timestampSec: number | null; schedule?: PkgSchedule }[]
}

export interface PkgBank {
  key: string
  title: string
  description: string
  questions: (QuestionInput & { pid: string })[]
  exams: { title: string; settings: ExamSettings; selection: { mode: 'random'; count: number; topics: string[]; difficulties: number[] } | { mode: 'manual'; pids: string[] } }[]
}

/** Blocos/anexos guardam `ref` no lugar do id local. */
export interface PkgNotebook {
  title: string
  pages: { title: string; blocks: (Block & { ref?: ItemRef })[] }[]
}

export interface PkgMindmap {
  title: string
  data: Omit<MindMapData, 'nodes'> & { nodes: (MindMapData['nodes'][number] & { ref?: LessonRef })[] }
}

export interface TramotakPackage {
  format: typeof PACKAGE_FORMAT
  version: number
  createdAt: number
  appVersion: string
  courses: PkgCourse[]
  decks: PkgDeck[]
  banks: PkgBank[]
  notebooks: PkgNotebook[]
  mindmaps: PkgMindmap[]
}

const MAX_PACKAGE_BYTES = 300 * 1024 * 1024

// ── Catálogo ────────────────────────────────────────────────────────────────

export function exportCatalog(db: Database): ExportCatalog {
  const all = <T>(sql: string) => db.prepare(sql).all() as T[]
  return {
    courses: all(`SELECT c.id, c.title,
        (SELECT COUNT(*) FROM notes n JOIN lessons l ON l.id = n.lesson_id WHERE l.course_id = c.id) AS notes,
        (SELECT COUNT(*) FROM transcripts t JOIN lessons l ON l.id = t.lesson_id WHERE l.course_id = c.id) AS transcripts,
        (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = c.id AND p.completed_at IS NOT NULL) AS completed
      FROM courses c ORDER BY c.title`),
    decks: all('SELECT d.id, d.title, (SELECT COUNT(*) FROM cards WHERE deck_id = d.id) AS cards FROM decks d ORDER BY d.title'),
    banks: all('SELECT b.id, b.title, (SELECT COUNT(*) FROM questions WHERE bank_id = b.id) AS questions FROM question_banks b ORDER BY b.title'),
    notebooks: all('SELECT n.id, n.title, (SELECT COUNT(*) FROM notebook_pages WHERE notebook_id = n.id) AS pages FROM notebooks n ORDER BY n.title'),
    mindmaps: (all('SELECT id, title, data_json AS data FROM mindmaps ORDER BY title') as { id: number; title: string; data: string }[]).map((m) => ({
      id: m.id,
      title: m.title,
      nodes: (JSON.parse(m.data) as MindMapData).nodes.length
    }))
  }
}

// ── Exportar ────────────────────────────────────────────────────────────────

const ids = (list: unknown): number[] => (Array.isArray(list) ? [...new Set(list.filter((n): n is number => Number.isInteger(n)))] : [])

export function buildPackage(db: Database, input: ExportSelection, appVersion: string, now = Math.floor(Date.now() / 1000)): TramotakPackage {
  const sel = { ...input, courseIds: ids(input.courseIds), deckIds: ids(input.deckIds), bankIds: ids(input.bankIds), notebookIds: ids(input.notebookIds), mindmapIds: ids(input.mindmapIds) }
  const courseKeys = new Map<number, string>()
  const courseKey = (id: number) => {
    if (!courseKeys.has(id)) courseKeys.set(id, `c${courseKeys.size + 1}`)
    return courseKeys.get(id)!
  }
  const lessonInfo = db.prepare('SELECT course_id AS courseId, rel_path AS relPath FROM lessons WHERE id = ?')
  const lessonRef = (lessonId: number | null): LessonRef | null => {
    if (lessonId === null) return null
    const row = lessonInfo.get(lessonId) as { courseId: number; relPath: string } | undefined
    return row ? { course: courseKey(row.courseId), relPath: row.relPath } : null
  }
  const courseExists = db.prepare('SELECT 1 FROM courses WHERE id = ?')
  const courseRef = (courseId: number): LessonRef | null => (courseExists.get(courseId) ? { course: courseKey(courseId), relPath: null } : null)
  for (const id of sel.courseIds) courseKey(id)

  const deckKeys = new Map(sel.deckIds.map((id, i) => [id, `d${i + 1}`]))
  const bankKeys = new Map(sel.bankIds.map((id, i) => [id, `b${i + 1}`]))

  const decks: PkgDeck[] = sel.deckIds.flatMap((id) => {
    const deck = db.prepare('SELECT id, title, description, course_id AS courseId FROM decks WHERE id = ?').get(id) as
      | { id: number; title: string; description: string; courseId: number | null }
      | undefined
    if (!deck) return []
    const cards = db
      .prepare(
        `SELECT front, back, lesson_id AS lessonId, timestamp_sec AS timestampSec, state, step, interval_days AS intervalDays, ease, due, reps, lapses,
                last_review_at AS lastReviewAt FROM cards WHERE deck_id = ? ORDER BY id`
      )
      .all(id) as unknown as (PkgSchedule & { front: string; back: string; lessonId: number | null; timestampSec: number | null })[]
    return [
      {
        key: deckKeys.get(id)!,
        title: deck.title,
        description: deck.description,
        course: deck.courseId !== null ? courseKey(deck.courseId) : null,
        cards: cards.map(({ front, back, lessonId, timestampSec, ...schedule }) => ({
          front,
          back,
          ref: lessonRef(lessonId),
          timestampSec,
          ...(sel.includeSchedule ? { schedule } : {})
        }))
      }
    ]
  })

  const banks: PkgBank[] = sel.bankIds.flatMap((id) => {
    const bank = db.prepare('SELECT title, description FROM question_banks WHERE id = ?').get(id) as { title: string; description: string } | undefined
    if (!bank) return []
    const rows = db
      .prepare('SELECT id, type, statement, options_json AS options, key_json AS key, explanation, topic, difficulty, points FROM questions WHERE bank_id = ? ORDER BY id')
      .all(id) as { id: number; type: QuestionInput['type']; statement: string; options: string; key: string; explanation: string; topic: string; difficulty: number; points: number }[]
    const pids = new Map(rows.map((r, i) => [r.id, `q${i + 1}`]))
    const exams = db.prepare('SELECT title, settings_json AS settings, selection_json AS selection FROM exams WHERE bank_id = ? ORDER BY id').all(id) as {
      title: string
      settings: string
      selection: string
    }[]
    return [
      {
        key: bankKeys.get(id)!,
        title: bank.title,
        description: bank.description,
        questions: rows.map((r) => ({
          pid: pids.get(r.id)!,
          type: r.type,
          statement: r.statement,
          options: JSON.parse(r.options),
          key: JSON.parse(r.key),
          explanation: r.explanation,
          topic: r.topic,
          difficulty: r.difficulty,
          points: r.points
        })),
        exams: exams.map((e) => {
          const selection = JSON.parse(e.selection) as ExamSelection
          return {
            title: e.title,
            settings: JSON.parse(e.settings),
            selection:
              selection.mode === 'manual'
                ? { mode: 'manual' as const, pids: selection.questionIds.map((q) => pids.get(q)).filter((p): p is string => Boolean(p)) }
                : selection
          }
        })
      }
    ]
  })

  const blockRef = (b: Block): ItemRef | undefined => {
    if (b.type !== 'resource') return undefined
    const r = b.resource
    if (r.kind === 'lesson') return lessonRef(r.id) ?? undefined
    if (r.kind === 'course') return courseRef(r.id) ?? undefined
    if (r.kind === 'deck' && deckKeys.has(r.id)) return { deck: deckKeys.get(r.id)! }
    if (r.kind === 'bank' && bankKeys.has(r.id)) return { bank: bankKeys.get(r.id)! }
    return undefined
  }

  const notebooks: PkgNotebook[] = sel.notebookIds.flatMap((id) => {
    const nb = db.prepare('SELECT title FROM notebooks WHERE id = ?').get(id) as { title: string } | undefined
    if (!nb) return []
    const pages = db.prepare('SELECT title, blocks_json AS blocks FROM notebook_pages WHERE notebook_id = ? ORDER BY position').all(id) as { title: string; blocks: string }[]
    return [
      {
        title: nb.title,
        pages: pages.map((p) => ({
          title: p.title,
          blocks: (JSON.parse(p.blocks) as Block[]).map((b) => {
            const ref = blockRef(b)
            return ref ? { ...b, ref } : b
          })
        }))
      }
    ]
  })

  const mindmaps: PkgMindmap[] = sel.mindmapIds.flatMap((id) => {
    const row = db.prepare('SELECT title, data_json AS data FROM mindmaps WHERE id = ?').get(id) as { title: string; data: string } | undefined
    if (!row) return []
    const data = JSON.parse(row.data) as MindMapData
    return [
      {
        title: row.title,
        data: {
          ...data,
          nodes: data.nodes.map((n) => {
            const a = n.attachment
            const ref = a?.kind === 'lesson' ? lessonRef(a.id) : a?.kind === 'course' ? courseRef(a.id) : null
            return ref ? { ...n, ref } : n
          })
        }
      }
    ]
  })

  // Cursos por último: a lista final inclui os referenciados pelos itens acima.
  const withData = new Set(sel.courseIds)
  const courses: PkgCourse[] = [...courseKeys.entries()].flatMap(([id, key]) => {
    const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(id) as { title: string } | undefined
    if (!course) return []
    const lessons = (db.prepare('SELECT rel_path AS relPath FROM lessons WHERE course_id = ? ORDER BY id').all(id) as { relPath: string }[]).map((l) => l.relPath)
    const full = withData.has(id)
    return [
      {
        key,
        title: course.title,
        lessons,
        withData: full,
        notes: full
          ? (db
              .prepare(
                `SELECT l.rel_path AS relPath, n.timestamp_sec AS timestampSec, n.body_md AS body, n.created_at AS createdAt
                   FROM notes n JOIN lessons l ON l.id = n.lesson_id WHERE l.course_id = ? ORDER BY n.id`
              )
              .all(id) as PkgCourse['notes'])
          : [],
        progress:
          full && sel.includeProgress
            ? (
                db
                  .prepare(
                    `SELECT l.rel_path AS relPath, p.position_sec AS positionSec, p.duration_sec AS durationSec, p.completed_at AS completedAt,
                            p.favorite, p.last_watched_at AS lastWatchedAt
                       FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = ?`
                  )
                  .all(id) as (Omit<PkgCourse['progress'][number], 'favorite'> & { favorite: number })[]
              ).map((p) => ({ ...p, favorite: Boolean(p.favorite) }))
            : [],
        transcripts: full
          ? (
              db
                .prepare(
                  `SELECT l.rel_path AS relPath, t.provider, t.model, t.language, t.segments_json AS segments
                     FROM transcripts t JOIN lessons l ON l.id = t.lesson_id WHERE l.course_id = ?`
                )
                .all(id) as (Omit<PkgCourse['transcripts'][number], 'segments'> & { segments: string })[]
            ).map((t) => ({ ...t, segments: JSON.parse(t.segments) }))
          : []
      }
    ]
  })

  return { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, createdAt: now, appVersion, courses, decks, banks, notebooks, mindmaps }
}

export function serializePackage(pkg: TramotakPackage): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(pkg), 'utf8'))
}

// ── Ler ─────────────────────────────────────────────────────────────────────

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown, max = 100_000) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const key = (v: unknown) => (typeof v === 'string' && /^[a-z]\d{1,6}$/.test(v) ? v : null)

function readRef(v: unknown): LessonRef | null {
  const r = v as { course?: unknown; relPath?: unknown } | null
  const course = key(r?.course)
  if (!course) return null
  return { course, relPath: typeof r?.relPath === 'string' ? r.relPath.slice(0, 2000) : null }
}

/** Abre um pacote (gzip ou JSON puro) e normaliza tudo o que vem dele; dado estranho é descartado. */
export function parsePackage(buffer: Buffer): TramotakPackage {
  let json: string
  try {
    json = (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer, { maxOutputLength: MAX_PACKAGE_BYTES }) : buffer).toString('utf8')
  } catch {
    throw new Error('Arquivo de pacote corrompido ou grande demais')
  }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Este arquivo não é um pacote do Tramotak')
  }
  if (raw?.format !== PACKAGE_FORMAT) throw new Error('Este arquivo não é um pacote do Tramotak')
  if (typeof raw.version !== 'number' || raw.version > PACKAGE_VERSION) throw new Error('Pacote feito por uma versão mais nova do Tramotak. Atualize o app para importá-lo.')

  const courses: PkgCourse[] = arr(raw.courses).flatMap((c0) => {
    const c = c0 as Record<string, unknown>
    const k = key(c?.key)
    if (!k) return []
    return [
      {
        key: k,
        title: text(c.title, 300) || 'Curso',
        lessons: arr(c.lessons).filter((p): p is string => typeof p === 'string').slice(0, 50_000),
        withData: c.withData === true,
        notes: arr(c.notes).flatMap((n0) => {
          const n = n0 as Record<string, unknown>
          const body = text(n?.body, 20_000).trim()
          return typeof n?.relPath === 'string' && body ? [{ relPath: n.relPath, timestampSec: num(n.timestampSec), body, createdAt: num(n.createdAt) ?? 0 }] : []
        }),
        progress: arr(c.progress).flatMap((p0) => {
          const p = p0 as Record<string, unknown>
          return typeof p?.relPath === 'string'
            ? [
                {
                  relPath: p.relPath,
                  positionSec: Math.max(0, num(p.positionSec) ?? 0),
                  durationSec: num(p.durationSec),
                  completedAt: num(p.completedAt),
                  favorite: p.favorite === true,
                  lastWatchedAt: num(p.lastWatchedAt)
                }
              ]
            : []
        }),
        transcripts: arr(c.transcripts).flatMap((t0) => {
          const t = t0 as Record<string, unknown>
          const segments = arr(t?.segments).flatMap((s0) => {
            const s = s0 as Record<string, unknown>
            const start = num(s?.start)
            const end = num(s?.end)
            const body = text(s?.text, 5000)
            return start !== null && end !== null && body ? [{ start, end, text: body }] : []
          })
          return typeof t?.relPath === 'string' && segments.length
            ? [{ relPath: t.relPath, provider: text(t.provider, 20) || 'groq', model: text(t.model, 120), language: text(t.language, 10), segments }]
            : []
        })
      }
    ]
  })

  const decks: PkgDeck[] = arr(raw.decks).flatMap((d0) => {
    const d = d0 as Record<string, unknown>
    const k = key(d?.key)
    if (!k) return []
    return [
      {
        key: k,
        title: text(d.title, 200) || 'Baralho',
        description: text(d.description, 2000),
        course: key(d.course),
        cards: arr(d.cards).flatMap((c0) => {
          const c = c0 as Record<string, unknown>
          const front = text(c?.front, 10_000).trim()
          if (!front) return []
          const s = c.schedule as Record<string, unknown> | undefined
          const schedule: PkgSchedule | undefined =
            s && ['new', 'learning', 'review', 'relearning'].includes(String(s.state))
              ? {
                  state: String(s.state),
                  step: Math.max(0, Math.round(num(s.step) ?? 0)),
                  intervalDays: Math.max(0, num(s.intervalDays) ?? 0),
                  ease: Math.min(5, Math.max(1.3, num(s.ease) ?? 2.5)),
                  due: Math.max(0, Math.round(num(s.due) ?? 0)),
                  reps: Math.max(0, Math.round(num(s.reps) ?? 0)),
                  lapses: Math.max(0, Math.round(num(s.lapses) ?? 0)),
                  lastReviewAt: num(s.lastReviewAt)
                }
              : undefined
          return [{ front, back: text(c.back, 10_000), ref: readRef(c.ref), timestampSec: num(c.timestampSec), ...(schedule ? { schedule } : {}) }]
        })
      }
    ]
  })

  const banks: PkgBank[] = arr(raw.banks).flatMap((b0) => {
    const b = b0 as Record<string, unknown>
    const k = key(b?.key)
    if (!k) return []
    const questions = arr(b.questions).flatMap((q0) => {
      const q = q0 as QuestionInput & { pid?: unknown }
      const pid = key(q?.pid)
      if (!pid) return []
      try {
        return [{ ...validateQuestion(q), pid }]
      } catch {
        return []
      }
    })
    const exams = arr(b.exams).flatMap((e0) => {
      const e = e0 as { title?: unknown; settings?: ExamSettings; selection?: Record<string, unknown> }
      const s = e?.selection
      if (!s) return []
      const selection =
        s.mode === 'manual'
          ? { mode: 'manual' as const, pids: arr(s.pids).filter((p): p is string => typeof p === 'string') }
          : {
              mode: 'random' as const,
              count: Math.max(1, Math.round(num(s.count) ?? 10)),
              topics: arr(s.topics).filter((t): t is string => typeof t === 'string'),
              difficulties: arr(s.difficulties).filter((d): d is number => Number.isInteger(d))
            }
      return [{ title: text(e.title, 200) || 'Simulado', settings: (e.settings ?? {}) as ExamSettings, selection }]
    })
    return [{ key: k, title: text(b.title, 200) || 'Banco', description: text(b.description, 2000), questions, exams }]
  })

  const notebooks: PkgNotebook[] = arr(raw.notebooks).flatMap((n0) => {
    const n = n0 as Record<string, unknown>
    return [
      {
        title: text(n?.title, 200) || 'Caderno',
        pages: arr(n?.pages).map((p0) => {
          const p = p0 as Record<string, unknown>
          const rawBlocks = arr(p?.blocks) as (Block & { ref?: unknown })[]
          const refs = new Map(rawBlocks.map((b) => [b?.id, b?.ref]))
          let blocks: Block[]
          try {
            blocks = validateBlocks(rawBlocks)
          } catch {
            blocks = []
          }
          return {
            title: text(p?.title, 300),
            blocks: blocks.map((b) => {
              const r = refs.get(b.id) as Record<string, unknown> | undefined
              const ref: ItemRef | undefined = key(r?.deck) ? { deck: key(r!.deck)! } : key(r?.bank) ? { bank: key(r!.bank)! } : (readRef(r) ?? undefined)
              return ref ? { ...b, ref } : b
            })
          }
        })
      }
    ]
  })

  const mindmaps: PkgMindmap[] = arr(raw.mindmaps).flatMap((m0) => {
    const m = m0 as { title?: unknown; data?: { nodes?: { id?: unknown; ref?: unknown }[] } }
    try {
      const refs = new Map(arr(m?.data?.nodes).map((n) => [(n as { id?: unknown }).id, readRef((n as { ref?: unknown }).ref)]))
      const data = validateMap(m.data)
      return [
        {
          title: text(m.title, 200) || 'Mapa mental',
          data: { ...data, nodes: data.nodes.map((n) => (refs.get(n.id) ? { ...n, ref: refs.get(n.id)! } : n)) }
        }
      ]
    } catch {
      return []
    }
  })

  return { format: PACKAGE_FORMAT, version: raw.version, createdAt: num(raw.createdAt) ?? 0, appVersion: text(raw.appVersion, 30), courses, decks, banks, notebooks, mindmaps }
}

// ── Importar ────────────────────────────────────────────────────────────────

/** Curso local mais parecido: mesmo título ou pelo menos metade das aulas com o mesmo caminho. */
export function suggestCourse(db: Database, course: PkgCourse): number | null {
  const locals = db.prepare('SELECT id, title FROM courses').all() as { id: number; title: string }[]
  const pkgPaths = new Set(course.lessons)
  let best: { id: number; score: number } | null = null
  for (const local of locals) {
    const paths = (db.prepare('SELECT rel_path AS p FROM lessons WHERE course_id = ?').all(local.id) as { p: string }[]).map((r) => r.p)
    const overlap = pkgPaths.size ? paths.filter((p) => pkgPaths.has(p)).length / pkgPaths.size : 0
    const score = overlap + (normalize(local.title).trim() === normalize(course.title).trim() ? 1 : 0)
    if ((overlap >= 0.5 || score >= 1) && (!best || score > best.score)) best = { id: local.id, score }
  }
  return best?.id ?? null
}

export function previewPackage(db: Database, pkg: TramotakPackage, token: string): PackagePreview {
  return {
    token,
    createdAt: pkg.createdAt,
    appVersion: pkg.appVersion,
    courses: pkg.courses.map((c) => ({
      key: c.key,
      title: c.title,
      lessons: c.lessons.length,
      notes: c.notes.length,
      transcripts: c.transcripts.length,
      progress: c.progress.length,
      withData: c.withData,
      match: suggestCourse(db, c)
    })),
    decks: pkg.decks.map((d) => ({ title: d.title, cards: d.cards.length })),
    banks: pkg.banks.map((b) => ({ title: b.title, questions: b.questions.length })),
    notebooks: pkg.notebooks.map((n) => ({ title: n.title, pages: n.pages.length })),
    mindmaps: pkg.mindmaps.map((m) => ({ title: m.title }))
  }
}

/** Importa tudo como itens novos, numa transação. Dados de curso só entram nos cursos ligados em `courseMap`. */
export function importPackage(db: Database, pkg: TramotakPackage, courseMap: Record<string, number | null>): PackageImportResult {
  const result: PackageImportResult = { decks: 0, cards: 0, banks: 0, questions: 0, notebooks: 0, mindmaps: 0, notes: 0, progress: 0, transcripts: 0, unlinked: 0 }
  const courseExists = db.prepare('SELECT title FROM courses WHERE id = ?')
  const target = (k: string | null): number | null => {
    const id = k ? courseMap[k] : null
    return Number.isInteger(id) && courseExists.get(id as number) ? (id as number) : null
  }
  const findLesson = db.prepare('SELECT id, title FROM lessons WHERE course_id = ? AND rel_path = ?')
  const lessonOf = (ref: LessonRef | null): { id: number; title: string } | null => {
    if (!ref || ref.relPath === null) return null
    const courseId = target(ref.course)
    const row = courseId !== null ? (findLesson.get(courseId, ref.relPath) as { id: number; title: string } | undefined) : undefined
    return row ?? null
  }

  return transaction(db, () => {
    // Dados dos cursos (anotações, progresso, transcrições) nas aulas correspondentes.
    const noteExists = db.prepare('SELECT 1 FROM notes WHERE lesson_id = ? AND body_md = ? AND timestamp_sec IS ?')
    const mergeProgress = db.prepare(
      `INSERT INTO lesson_progress (lesson_id, position_sec, duration_sec, completed_at, favorite, last_watched_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (lesson_id) DO UPDATE SET
         position_sec = CASE WHEN COALESCE(excluded.last_watched_at, 0) > COALESCE(lesson_progress.last_watched_at, 0) THEN excluded.position_sec ELSE lesson_progress.position_sec END,
         duration_sec = COALESCE(lesson_progress.duration_sec, excluded.duration_sec),
         completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at),
         favorite = MAX(lesson_progress.favorite, excluded.favorite),
         last_watched_at = MAX(COALESCE(lesson_progress.last_watched_at, 0), COALESCE(excluded.last_watched_at, 0))`
    )
    for (const c of pkg.courses) {
      const courseId = target(c.key)
      if (courseId === null || !c.withData) continue
      const lesson = (relPath: string) => findLesson.get(courseId, relPath) as { id: number } | undefined
      for (const n of c.notes) {
        const l = lesson(n.relPath)
        if (!l) {
          result.unlinked++
          continue
        }
        if (noteExists.get(l.id, n.body, n.timestampSec)) continue
        createNote(db, { lessonId: l.id, timestampSec: n.timestampSec, body: n.body }, n.createdAt || undefined)
        result.notes++
      }
      for (const p of c.progress) {
        const l = lesson(p.relPath)
        if (!l) continue
        mergeProgress.run(l.id, p.positionSec, p.durationSec, p.completedAt, p.favorite ? 1 : 0, p.lastWatchedAt)
        result.progress++
      }
      for (const t of c.transcripts) {
        const l = lesson(t.relPath)
        if (!l || getTranscript(db, l.id)) continue
        saveTranscript(db, l.id, { provider: t.provider === 'local' ? 'local' : 'groq', model: t.model, language: t.language, segments: t.segments })
        result.transcripts++
      }
    }

    const deckIds = new Map<string, { id: number; title: string }>()
    const setSchedule = db.prepare(
      'UPDATE cards SET state = ?, step = ?, interval_days = ?, ease = ?, due = ?, reps = ?, lapses = ?, last_review_at = ? WHERE id = ?'
    )
    for (const d of pkg.decks) {
      const deckId = createDeck(db, { title: d.title, description: d.description, courseId: target(d.course) })
      deckIds.set(d.key, { id: deckId, title: d.title })
      result.decks++
      for (const c of d.cards) {
        const lesson = lessonOf(c.ref)
        if (c.ref && !lesson) result.unlinked++
        const card = createCard(db, { deckId, front: c.front, back: c.back, lessonId: lesson?.id ?? null, timestampSec: lesson ? c.timestampSec : null })
        if (c.schedule) {
          const s = c.schedule
          setSchedule.run(s.state, s.step, s.intervalDays, s.ease, s.due, s.reps, s.lapses, s.lastReviewAt, card.id)
        }
        result.cards++
      }
    }

    const bankIds = new Map<string, { id: number; title: string }>()
    for (const b of pkg.banks) {
      const bankId = createBank(db, { title: b.title, description: b.description })
      bankIds.set(b.key, { id: bankId, title: b.title })
      result.banks++
      const qids = new Map<string, number>()
      for (const { pid, ...q } of b.questions) {
        qids.set(pid, createQuestion(db, bankId, q).id)
        result.questions++
      }
      for (const e of b.exams) {
        const selection: ExamSelection =
          e.selection.mode === 'manual'
            ? { mode: 'manual', questionIds: e.selection.pids.map((p) => qids.get(p)).filter((id): id is number => id !== undefined) }
            : e.selection
        if (selection.mode === 'manual' && selection.questionIds.length === 0) continue
        try {
          createExam(db, bankId, { title: e.title, settings: e.settings, selection })
        } catch {
          // simulado inválido para o banco importado: fica de fora
        }
      }
    }

    for (const n of pkg.notebooks) {
      const notebookId = createNotebook(db, n.title)
      result.notebooks++
      // createNotebook já cria a primeira página; ela recebe a primeira página do pacote.
      const first = db.prepare('SELECT id FROM notebook_pages WHERE notebook_id = ? ORDER BY position LIMIT 1').get(notebookId) as { id: number } | undefined
      n.pages.forEach((p, i) => {
        const blocks = p.blocks.flatMap(({ ref, ...b }) => {
          if (b.type !== 'resource') return [b as Block]
          const r = ref as ItemRef | undefined
          const resolved =
            r && 'deck' in r
              ? deckIds.get(r.deck) && { kind: 'deck' as const, ...deckIds.get(r.deck)! }
              : r && 'bank' in r
                ? bankIds.get(r.bank) && { kind: 'bank' as const, ...bankIds.get(r.bank)! }
                : r && r.relPath !== null
                  ? (() => {
                      const l = lessonOf(r)
                      return l ? { kind: 'lesson' as const, id: l.id, title: b.resource.title } : null
                    })()
                  : r
                    ? (() => {
                        const id = target(r.course)
                        return id !== null ? { kind: 'course' as const, id, title: b.resource.title } : null
                      })()
                    : null
          if (!resolved) {
            result.unlinked++
            return []
          }
          return [{ ...b, resource: { ...resolved, title: b.resource.title || resolved.title } } as Block]
        })
        const pageId = i === 0 && first ? first.id : createPage(db, notebookId).id
        savePage(db, pageId, { title: p.title, blocks })
      })
    }

    for (const m of pkg.mindmaps) {
      const nodes = m.data.nodes.map(({ ref, ...node }) => {
        if (!node.attachment || node.attachment.kind === 'url') return node
        const lesson = ref?.relPath ? lessonOf(ref) : null
        const courseId = ref && ref.relPath === null ? target(ref.course) : null
        if (lesson) return { ...node, attachment: { kind: 'lesson' as const, id: lesson.id, title: node.attachment.title } }
        if (courseId !== null) return { ...node, attachment: { kind: 'course' as const, id: courseId, title: node.attachment.title } }
        result.unlinked++
        return { ...node, attachment: null }
      })
      createMindMap(db, m.title, { ...m.data, nodes })
      result.mindmaps++
    }

    return result
  })
}
