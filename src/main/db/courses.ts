import type { Numbering, ScannedLesson, ScannedModule, ScanResult } from '@shared/course'
import { transaction, type Database } from './database'

export interface NewCourse {
  title: string
  rootPath: string
  numbering: Numbering
}

/** Grava curso + módulos + aulas + anexos de um scan, tudo ou nada. Devolve o id do curso. */
export function insertScannedCourse(db: Database, course: NewCourse, scan: ScanResult): number {
  const insertCourse = db.prepare(
    'INSERT INTO courses (title, root_path, structure, numbering) VALUES (?, ?, ?, ?)'
  )
  const insertModule = db.prepare(
    'INSERT INTO modules (course_id, parent_id, title, rel_path, position) VALUES (?, ?, ?, ?, ?)'
  )
  const insertLesson = db.prepare(
    `INSERT INTO lessons (course_id, module_id, title, rel_path, kind, position, file_size, mtime_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertAsset = db.prepare(
    'INSERT INTO lesson_assets (lesson_id, kind, rel_path, lang) VALUES (?, ?, ?, ?)'
  )

  return transaction(db, () => {
    const courseId = Number(
      insertCourse.run(course.title, course.rootPath, scan.structure, course.numbering).lastInsertRowid
    )

    const saveLessons = (lessons: ScannedLesson[], moduleId: number | null) => {
      lessons.forEach((l, position) => {
        const lessonId = insertLesson.run(
          courseId, moduleId, l.title, l.relPath, l.kind, position, l.size, l.mtimeMs
        ).lastInsertRowid
        for (const a of l.assets) insertAsset.run(lessonId, a.kind, a.relPath, a.lang)
      })
    }

    const saveModules = (modules: ScannedModule[], parentId: number | null) => {
      modules.forEach((m, position) => {
        const moduleId = Number(
          insertModule.run(courseId, parentId, m.title, m.relPath, position).lastInsertRowid
        )
        saveLessons(m.lessons, moduleId)
        saveModules(m.children, moduleId)
      })
    }

    saveLessons(scan.lessons, null)
    saveModules(scan.modules, null)
    return courseId
  })
}

export interface CourseRow {
  id: number
  title: string
  rootPath: string
  structure: string
  lessonCount: number
}

export function listCourses(db: Database): CourseRow[] {
  return db
    .prepare(
      `SELECT c.id, c.title, c.root_path AS rootPath, c.structure,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessonCount
         FROM courses c
        ORDER BY COALESCE(c.last_opened_at, c.created_at) DESC`
    )
    .all() as unknown as CourseRow[]
}

export interface LessonNode {
  id: number
  title: string
  relPath: string
  kind: string
}

export interface ModuleNode {
  id: number
  title: string
  lessons: LessonNode[]
  children: ModuleNode[]
}

/** Árvore do curso como está no banco (aulas da raiz + módulos aninhados). */
export function getCourseTree(db: Database, courseId: number): { lessons: LessonNode[]; modules: ModuleNode[] } {
  const modules = db
    .prepare('SELECT id, parent_id AS parentId, title FROM modules WHERE course_id = ? ORDER BY position')
    .all(courseId) as unknown as { id: number; parentId: number | null; title: string }[]
  const lessons = db
    .prepare(
      `SELECT id, module_id AS moduleId, title, rel_path AS relPath, kind
         FROM lessons WHERE course_id = ? ORDER BY position`
    )
    .all(courseId) as unknown as (LessonNode & { moduleId: number | null })[]

  const nodes = new Map<number, ModuleNode>(
    modules.map((m) => [m.id, { id: m.id, title: m.title, lessons: [], children: [] }])
  )
  const rootLessons: LessonNode[] = []
  for (const { moduleId, ...lesson } of lessons) {
    if (moduleId === null) rootLessons.push(lesson)
    else nodes.get(moduleId)!.lessons.push(lesson)
  }
  const rootModules: ModuleNode[] = []
  for (const m of modules) {
    const node = nodes.get(m.id)!
    if (m.parentId === null) rootModules.push(node)
    else nodes.get(m.parentId)!.children.push(node)
  }
  return { lessons: rootLessons, modules: rootModules }
}

export function deleteCourse(db: Database, courseId: number): void {
  db.prepare('DELETE FROM courses WHERE id = ?').run(courseId)
}
