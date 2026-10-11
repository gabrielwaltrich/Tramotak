import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ImportRequest, Numbering, PreviewResponse, Structure } from '@shared/course'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import {
  deleteCourse,
  findCourseByRoot,
  getCourseDetail,
  getCourseRow,
  insertScannedCourse,
  listCourseSummaries,
  revalidateCourse,
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

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

export function registerCourseIpc(db: Database): void {
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
    return insertScannedCourse(db, { title, rootPath: root, numbering: input.numbering, scanStructure: input.structure }, scan)
  })

  ipcMain.handle(IPC.coursesList, () => listCourseSummaries(db))
  ipcMain.handle(IPC.coursesGet, (_e, id: number) => getCourseDetail(db, assertId(id)))

  ipcMain.handle(IPC.coursesUpdate, (_e, id: number, patch: { title: string; description: string }) =>
    updateCourse(db, assertId(id), { title: String(patch?.title ?? ''), description: String(patch?.description ?? '') })
  )

  ipcMain.handle(IPC.coursesDelete, (_e, id: number) => deleteCourse(db, assertId(id)))

  ipcMain.handle(IPC.coursesRevalidate, async (_e, id: number) => {
    const course = getCourseRow(db, assertId(id))
    const root = await assertDirectory(course.rootPath).catch(() => {
      throw new Error('A pasta do curso não existe mais neste caminho')
    })
    const scan = await scanCourse(root, { structure: course.scanStructure, numbering: course.numbering })
    return revalidateCourse(db, course.id, scan)
  })
}
