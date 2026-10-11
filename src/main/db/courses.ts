import type {
  CourseDetail,
  CourseLesson,
  CourseModuleNode,
  CourseSummary,
  LessonKind,
  Numbering,
  RevalidateResult,
  ScannedLesson,
  ScannedModule,
  ScanResult,
  Structure
} from '@shared/course'
import { transaction, type Database } from './database'

export interface NewCourse {
  title: string
  rootPath: string
  numbering: Numbering
  /** Estrutura escolhida pelo usuário (pode ser 'auto'); reaproveitada ao revalidar. */
  scanStructure: Structure
}

export interface CourseRow {
  id: number
  title: string
  description: string
  rootPath: string
  structure: Exclude<Structure, 'auto'>
  scanStructure: Structure
  numbering: Numbering
  createdAt: number
  lastOpenedAt: number | null
}

interface LessonRow {
  id: number
  moduleId: number | null
  title: string
  relPath: string
  kind: LessonKind
  durationSec: number | null
  completed: number
}

interface ModuleRow {
  id: number
  parentId: number | null
  title: string
}

type CourseTree = { lessons: CourseLesson[]; modules: CourseModuleNode[] }

const COURSE_COLUMNS = `id, title, description, root_path AS rootPath, structure,
  scan_structure AS scanStructure, numbering, created_at AS createdAt, last_opened_at AS lastOpenedAt`

function prepareWriters(db: Database) {
  const insertAsset = db.prepare('INSERT INTO lesson_assets (lesson_id, kind, rel_path, lang) VALUES (?, ?, ?, ?)')
  return {
    insertModule: db.prepare(
      'INSERT INTO modules (course_id, parent_id, title, rel_path, position) VALUES (?, ?, ?, ?, ?)'
    ),
    insertLesson: db.prepare(
      `INSERT INTO lessons (course_id, module_id, title, rel_path, kind, position, file_size, mtime_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    deleteAssets: db.prepare('DELETE FROM lesson_assets WHERE lesson_id = ?'),
    insertAssets(lessonId: number | bigint, lesson: ScannedLesson) {
      for (const a of lesson.assets) insertAsset.run(lessonId, a.kind, a.relPath, a.lang)
    }
  }
}

/** Grava curso + módulos + aulas + anexos de um scan, tudo ou nada. Devolve o id do curso. */
export function insertScannedCourse(db: Database, course: NewCourse, scan: ScanResult): number {
  const w = prepareWriters(db)

  return transaction(db, () => {
    const courseId = Number(
      db
        .prepare('INSERT INTO courses (title, root_path, structure, numbering, scan_structure) VALUES (?, ?, ?, ?, ?)')
        .run(course.title, course.rootPath, scan.structure, course.numbering, course.scanStructure).lastInsertRowid
    )

    const saveLessons = (lessons: ScannedLesson[], moduleId: number | null) => {
      lessons.forEach((l, position) => {
        const lessonId = w.insertLesson.run(
          courseId, moduleId, l.title, l.relPath, l.kind, position, l.size, l.mtimeMs
        ).lastInsertRowid
        w.insertAssets(lessonId, l)
      })
    }
    const saveModules = (modules: ScannedModule[], parentId: number | null) => {
      modules.forEach((m, position) => {
        const moduleId = Number(w.insertModule.run(courseId, parentId, m.title, m.relPath, position).lastInsertRowid)
        saveLessons(m.lessons, moduleId)
        saveModules(m.children, moduleId)
      })
    }

    saveLessons(scan.lessons, null)
    saveModules(scan.modules, null)
    return courseId
  })
}

export function getCourseRow(db: Database, courseId: number): CourseRow {
  const row = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`).get(courseId) as unknown as
    | CourseRow
    | undefined
  if (!row) throw new Error('Curso não encontrado')
  return row
}

export function findCourseByRoot(db: Database, rootPath: string): number | null {
  const row = db.prepare('SELECT id FROM courses WHERE root_path = ?').get(rootPath) as { id: number } | undefined
  return row?.id ?? null
}

function loadTree(db: Database, courseId: number): CourseTree {
  const modules = db
    .prepare('SELECT id, parent_id AS parentId, title FROM modules WHERE course_id = ? ORDER BY position')
    .all(courseId) as unknown as ModuleRow[]
  const lessons = db
    .prepare(
      `SELECT l.id, l.module_id AS moduleId, l.title, l.rel_path AS relPath, l.kind,
              l.duration_sec AS durationSec, (p.completed_at IS NOT NULL) AS completed
         FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id
        WHERE l.course_id = ? ORDER BY l.position`
    )
    .all(courseId) as unknown as LessonRow[]

  const nodes = new Map<number, CourseModuleNode>(
    modules.map((m) => [m.id, { id: m.id, title: m.title, lessons: [], children: [] }])
  )
  const rootLessons: CourseLesson[] = []
  for (const { moduleId, completed, ...rest } of lessons) {
    const lesson: CourseLesson = { ...rest, completed: Boolean(completed) }
    if (moduleId === null) rootLessons.push(lesson)
    else nodes.get(moduleId)!.lessons.push(lesson)
  }
  const rootModules: CourseModuleNode[] = []
  for (const m of modules) {
    const node = nodes.get(m.id)!
    if (m.parentId === null) rootModules.push(node)
    else nodes.get(m.parentId)!.children.push(node)
  }
  return { lessons: rootLessons, modules: rootModules }
}

/** Aulas na ordem de estudo: as da raiz, depois cada módulo em profundidade. */
export function orderedLessons(tree: CourseTree): CourseLesson[] {
  const out = [...tree.lessons]
  const walk = (mods: CourseModuleNode[]) => {
    for (const m of mods) {
      out.push(...m.lessons)
      walk(m.children)
    }
  }
  walk(tree.modules)
  return out
}

function summarize(db: Database, row: CourseRow, tree: CourseTree): CourseSummary {
  const all = orderedLessons(tree)
  const lastWatched = db
    .prepare(
      `SELECT l.id FROM lessons l JOIN lesson_progress p ON p.lesson_id = l.id
        WHERE l.course_id = ? AND p.last_watched_at IS NOT NULL
        ORDER BY p.last_watched_at DESC LIMIT 1`
    )
    .get(row.id) as { id: number } | undefined

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    rootPath: row.rootPath,
    lessonCount: all.length,
    completedCount: all.filter((l) => l.completed).length,
    durationSec: all.reduce((sum, l) => sum + (l.durationSec ?? 0), 0),
    createdAt: row.createdAt,
    lastOpenedAt: row.lastOpenedAt,
    resumeLessonId: lastWatched?.id ?? all[0]?.id ?? null
  }
}

export function listCourseSummaries(db: Database): CourseSummary[] {
  const rows = db
    .prepare(`SELECT ${COURSE_COLUMNS} FROM courses ORDER BY COALESCE(last_opened_at, created_at) DESC, id DESC`)
    .all() as unknown as CourseRow[]
  return rows.map((row) => summarize(db, row, loadTree(db, row.id)))
}

export function getCourseDetail(db: Database, courseId: number): CourseDetail {
  const row = getCourseRow(db, courseId)
  const tree = loadTree(db, courseId)
  return { ...summarize(db, row, tree), structure: row.structure, ...tree }
}

export function updateCourse(db: Database, courseId: number, patch: { title: string; description: string }): void {
  const title = patch.title.trim()
  if (!title) throw new Error('O título não pode ficar vazio')
  const { changes } = db
    .prepare('UPDATE courses SET title = ?, description = ?, updated_at = unixepoch() WHERE id = ?')
    .run(title, patch.description.trim(), courseId)
  if (!changes) throw new Error('Curso não encontrado')
}

export function deleteCourse(db: Database, courseId: number): void {
  db.prepare('DELETE FROM courses WHERE id = ?').run(courseId)
}

/**
 * Aplica um novo scan sobre um curso existente casando aulas e módulos pelo caminho relativo.
 * Aulas que continuam existindo mantêm id, progresso e anotações.
 */
export function revalidateCourse(db: Database, courseId: number, scan: ScanResult): RevalidateResult {
  const w = prepareWriters(db)
  const existingModules = new Map(
    (db.prepare('SELECT id, rel_path AS relPath FROM modules WHERE course_id = ?').all(courseId) as unknown as {
      id: number
      relPath: string
    }[]).map((m) => [m.relPath, m.id])
  )
  const existingLessons = new Map(
    (
      db
        .prepare('SELECT id, rel_path AS relPath, file_size AS size, mtime_ms AS mtimeMs FROM lessons WHERE course_id = ?')
        .all(courseId) as unknown as { id: number; relPath: string; size: number; mtimeMs: number }[]
    ).map((l) => [l.relPath, l])
  )

  const updateModule = db.prepare('UPDATE modules SET parent_id = ?, title = ?, position = ? WHERE id = ?')
  const updateLesson = db.prepare('UPDATE lessons SET module_id = ?, title = ?, kind = ?, position = ? WHERE id = ?')
  const updateLessonFile = db.prepare('UPDATE lessons SET file_size = ?, mtime_ms = ?, duration_sec = NULL WHERE id = ?')
  const deleteLesson = db.prepare('DELETE FROM lessons WHERE id = ?')
  const deleteModule = db.prepare('DELETE FROM modules WHERE id = ?')

  const result: RevalidateResult = { added: 0, removed: 0, updated: 0 }
  const keptModules = new Set<number>()
  const keptLessons = new Set<number>()

  transaction(db, () => {
    const saveLessons = (lessons: ScannedLesson[], moduleId: number | null) => {
      lessons.forEach((l, position) => {
        const current = existingLessons.get(l.relPath)
        let lessonId: number
        if (current) {
          lessonId = current.id
          updateLesson.run(moduleId, l.title, l.kind, position, lessonId)
          if (current.size !== l.size || current.mtimeMs !== l.mtimeMs) {
            updateLessonFile.run(l.size, l.mtimeMs, lessonId)
            result.updated++
          }
          w.deleteAssets.run(lessonId)
        } else {
          lessonId = Number(
            w.insertLesson.run(courseId, moduleId, l.title, l.relPath, l.kind, position, l.size, l.mtimeMs).lastInsertRowid
          )
          result.added++
        }
        keptLessons.add(lessonId)
        w.insertAssets(lessonId, l)
      })
    }

    const saveModules = (modules: ScannedModule[], parentId: number | null) => {
      modules.forEach((m, position) => {
        let moduleId = existingModules.get(m.relPath)
        if (moduleId !== undefined) updateModule.run(parentId, m.title, position, moduleId)
        else moduleId = Number(w.insertModule.run(courseId, parentId, m.title, m.relPath, position).lastInsertRowid)
        keptModules.add(moduleId)
        saveLessons(m.lessons, moduleId)
        saveModules(m.children, moduleId)
      })
    }

    saveLessons(scan.lessons, null)
    saveModules(scan.modules, null)

    // Aulas primeiro: as mantidas já foram movidas para os módulos novos antes de apagar os antigos.
    for (const l of existingLessons.values()) {
      if (!keptLessons.has(l.id)) {
        deleteLesson.run(l.id)
        result.removed++
      }
    }
    for (const id of existingModules.values()) if (!keptModules.has(id)) deleteModule.run(id)

    db.prepare('UPDATE courses SET structure = ?, updated_at = unixepoch() WHERE id = ?').run(scan.structure, courseId)
  })

  return result
}
