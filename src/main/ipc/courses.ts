import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ImportRequest, Numbering, PreviewResponse, ScanResult, Structure } from '@shared/course'
import { IPC } from '@shared/ipc'
import { transaction, type Database } from '../db/database'
import {
  deleteCourse,
  findCourseByRoot,
  getCourseDetail,
  getCourseRow,
  insertScannedCourse,
  listCourseSummaries,
  revalidateCourse,
  setTitleRules,
  updateCourse
} from '../db/courses'
import { scanCourse } from '../scanner/scan'

const STRUCTURES: Structure[] = ['auto', 'flat', 'modules', 'submodules']
const NUMBERINGS: Numbering[] = ['dot', 'dash', 'none']

async function assertDirectory(path: string): Promise<string> {
  if (typeof path !== 'string' || !path) throw new Error('Escolha uma pasta')
  const abs = resolve(path)
  const info = await stat(abs).catch(() => null)
  if (!info?.isDirectory()) throw new Error('Pasta não encontrada')
  return abs
}

function assertOptions(structure: Structure, numbering: Numbering) {
  if (!STRUCTURES.includes(structure) || !NUMBERINGS.includes(numbering)) throw new Error('Opções de importação inválidas')
}

/** Caminhos relativos de todas as aulas de um scan. */
function scannedPaths(scan: ScanResult): string[] {
  const out = scan.lessons.map((l) => l.relPath)
  const walk = (mods: ScanResult['modules']) => {
    for (const m of mods) {
      out.push(...m.lessons.map((l) => l.relPath))
      walk(m.children)
    }
  }
  walk(scan.modules)
  return out
}

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

/** `onScanned`: curso importado ou com arquivos relidos (para medir as durações que faltam). */
export function registerCourseIpc(db: Database, onScanned: (courseId: number) => void = () => {}): void {
  ipcMain.handle(IPC.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Escolha a pasta do curso', properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(
    IPC.preview,
    async (_e, input: { path: string; structure: Structure; numbering: Numbering }): Promise<PreviewResponse> => {
      assertOptions(input.structure, input.numbering)
      const root = await assertDirectory(input.path)
      const scan = await scanCourse(root, input)
      return { scan, suggestedTitle: basename(root), existingCourseId: findCourseByRoot(db, root) }
    }
  )

  ipcMain.handle(IPC.coursesImport, async (_e, input: ImportRequest) => {
    assertOptions(input.structure, input.numbering)
    const root = await assertDirectory(input.path)
    const title = input.title?.trim() || basename(root)
    if (findCourseByRoot(db, root) !== null) throw new Error('Esta pasta já foi importada')
    const scan = await scanCourse(root, input)
    if (scan.stats.lessons === 0) throw new Error('Nenhuma aula encontrada nesta pasta')
    const courseId = insertScannedCourse(db, { title, rootPath: root, numbering: input.numbering, scanStructure: input.structure }, scan)
    onScanned(courseId)
    return courseId
  })

  ipcMain.handle(IPC.coursesList, () => listCourseSummaries(db))
  ipcMain.handle(IPC.coursesSetTitleRules, (_e, id: number, rules: unknown) => setTitleRules(db, assertId(id), rules))
  ipcMain.handle(IPC.coursesGet, (_e, id: number) => getCourseDetail(db, assertId(id)))

  ipcMain.handle(IPC.coursesUpdate, (_e, id: number, patch: { title: string; description: string }) =>
    updateCourse(db, assertId(id), { title: String(patch?.title ?? ''), description: String(patch?.description ?? '') })
  )

  ipcMain.handle(IPC.coursesDelete, (_e, id: number) => deleteCourse(db, assertId(id)))

  ipcMain.handle(IPC.coursesRevalidate, async (_e, id: number) => {
    const course = getCourseRow(db, assertId(id))
    const root = await assertDirectory(course.rootPath).catch(() => {
      throw new Error('A pasta do curso não existe mais neste caminho. Se ela mudou de lugar, use “Trocar pasta…” no menu do curso.')
    })
    const scan = await scanCourse(root, { structure: course.scanStructure, numbering: course.numbering })
    const result = revalidateCourse(db, course.id, scan)
    onScanned(course.id)
    return result
  })

  /** Nova pasta para o curso: casa as aulas pelo caminho relativo, mantendo progresso e anotações. */
  ipcMain.handle(IPC.coursesRelocate, async (event, id: number) => {
    const course = getCourseRow(db, assertId(id))
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: `Nova pasta de “${course.title}”`, properties: ['openDirectory' as const] }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    const root = await assertDirectory(picked.filePaths[0])
    const other = findCourseByRoot(db, root)
    if (other !== null && other !== course.id) throw new Error('Esta pasta já pertence a outro curso')
    const scan = await scanCourse(root, { structure: course.scanStructure, numbering: course.numbering })
    if (scan.stats.lessons === 0) throw new Error('Nenhuma aula encontrada nesta pasta')
    // Pasta errada apagaria as aulas que não batem (com anotações e progresso): exige que a maioria corresponda.
    const existing = (db.prepare('SELECT rel_path AS p FROM lessons WHERE course_id = ?').all(course.id) as { p: string }[]).map((r) => r.p)
    const found = new Set(scannedPaths(scan))
    const matching = existing.filter((p) => found.has(p)).length
    if (existing.length > 0 && matching < existing.length / 2) {
      throw new Error(
        `Só ${matching} de ${existing.length} aulas do curso foram encontradas nesta pasta. Confira se é a pasta certa (se for outro curso, importe como novo).`
      )
    }
    return transaction(db, () => {
      db.prepare('UPDATE courses SET root_path = ? WHERE id = ?').run(root, course.id)
      const result = revalidateCourse(db, course.id, scan)
      onScanned(course.id)
      const kept = (db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(course.id) as { n: number }).n - result.added
      return { ...result, kept }
    })
  })
}
