/** Contratos de IPC compartilhados entre main, preload e renderer. */
import type {
  CourseDetail,
  CourseSummary,
  ImportRequest,
  Numbering,
  PreviewResponse,
  RevalidateResult,
  Structure
} from './course'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
}

export const IPC = {
  appInfo: 'app:info',
  pickFolder: 'dialog:pickFolder',
  preview: 'scanner:preview',
  coursesImport: 'courses:import',
  coursesList: 'courses:list',
  coursesGet: 'courses:get',
  coursesUpdate: 'courses:update',
  coursesDelete: 'courses:delete',
  coursesRevalidate: 'courses:revalidate'
} as const

export interface TramotakApi {
  app: {
    info(): Promise<AppInfo>
  }
  dialog: {
    /** Abre o seletor nativo de pasta; `null` se o usuário cancelar. */
    pickFolder(): Promise<string | null>
  }
  scanner: {
    preview(input: { path: string; structure: Structure; numbering: Numbering }): Promise<PreviewResponse>
  }
  courses: {
    import(input: ImportRequest): Promise<number>
    list(): Promise<CourseSummary[]>
    get(id: number): Promise<CourseDetail>
    update(id: number, patch: { title: string; description: string }): Promise<void>
    delete(id: number): Promise<void>
    revalidate(id: number): Promise<RevalidateResult>
  }
}
