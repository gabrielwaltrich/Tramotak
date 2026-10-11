/** Contratos de IPC compartilhados entre main, preload e renderer. */
import type {
  DashboardData,
  Note,
  LessonView,
  ProgressUpdate,
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
  /** Pasta onde ficam o banco e as preferências do app. */
  dataPath: string
}

export interface AppSettings {
  dailyGoalMinutes: number
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
  coursesRevalidate: 'courses:revalidate',
  lessonsGet: 'lessons:get',
  lessonsText: 'lessons:text',
  lessonsSetFavorite: 'lessons:setFavorite',
  lessonsSetDuration: 'lessons:setDuration',
  progressSave: 'progress:save',
  progressSetCompleted: 'progress:setCompleted',
  filesOpenLesson: 'files:openLesson',
  filesOpenAsset: 'files:openAsset',
  filesShowLesson: 'files:showLesson',
  notesList: 'notes:list',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesDelete: 'notes:delete',
  dashboardGet: 'dashboard:get',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  filesOpenDataFolder: 'files:openDataFolder'
} as const

export interface LessonText {
  format: 'markdown' | 'html' | 'text'
  content: string
}

export interface TramotakApi {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
  }
  dashboard: {
    get(): Promise<DashboardData>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
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
  lessons: {
    get(id: number): Promise<LessonView>
    /** Conteúdo de uma aula de texto (.md, .html, .txt). */
    text(id: number): Promise<LessonText>
    setFavorite(id: number, value: boolean): Promise<void>
    setDuration(id: number, durationSec: number): Promise<void>
  }
  progress: {
    save(update: ProgressUpdate): Promise<void>
    setCompleted(id: number, value: boolean): Promise<void>
  }
  files: {
    /** Abre no aplicativo padrão do sistema. */
    openLesson(id: number): Promise<void>
    openAsset(id: number): Promise<void>
    showLesson(id: number): Promise<void>
  }
  notes: {
    list(lessonId: number): Promise<Note[]>
    create(input: { lessonId: number; timestampSec: number | null; body: string }): Promise<Note>
    update(id: number, body: string): Promise<Note>
    delete(id: number): Promise<void>
  }
}
