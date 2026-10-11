/** Contratos de IPC compartilhados entre main, preload e renderer. */
import type { DeckDetail, DeckSummary, CardView, ImportResult, NewCard, StudyNext } from './flashcards'
import type { Rating } from './srs'
import type { CalendarDay, Task, TaskInput, TaskStatus } from './planner'
import type { HistoryEntry, HistoryFilter, ProgressData } from './progress'
import type {
  SearchHit,
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
  /** Notificações do sistema do Planner (blocos com horário e resumo do dia). */
  notificationsEnabled: boolean
  /** Antecedência do aviso de início de bloco, em minutos. */
  notifyLeadMinutes: 0 | 5 | 10 | 15
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
  filesOpenDataFolder: 'files:openDataFolder',
  searchQuery: 'search:query',
  decksList: 'decks:list',
  decksGet: 'decks:get',
  decksCreate: 'decks:create',
  decksUpdate: 'decks:update',
  decksDelete: 'decks:delete',
  decksForCourse: 'decks:forCourse',
  decksImport: 'decks:import',
  cardsCreate: 'cards:create',
  cardsUpdate: 'cards:update',
  cardsDelete: 'cards:delete',
  cardsReset: 'cards:reset',
  studyNext: 'study:next',
  studyAnswer: 'study:answer',
  navigate: 'app:navigate',
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksMove: 'tasks:move',
  tasksSetDone: 'tasks:setDone',
  tasksDelete: 'tasks:delete',
  tasksToday: 'tasks:today',
  calendarRange: 'calendar:range',
  statsGet: 'stats:get',
  statsHistory: 'stats:history'
} as const

export interface LessonText {
  format: 'markdown' | 'html' | 'text'
  content: string
}

export interface TramotakApi {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    /** O processo principal pede para abrir uma rota (ex.: clique numa notificação). Devolve o "desinscrever". */
    onNavigate(callback: (path: string) => void): () => void
  }
  dashboard: {
    get(): Promise<DashboardData>
  }
  search: {
    /** Busca global em cursos, módulos, aulas, anotações e flashcards. */
    query(text: string): Promise<SearchHit[]>
  }
  decks: {
    list(): Promise<DeckSummary[]>
    get(id: number): Promise<DeckDetail>
    create(input: { title: string; description?: string; courseId?: number | null }): Promise<number>
    update(id: number, patch: { title: string; description: string }): Promise<void>
    delete(id: number): Promise<void>
    /** Baralho ligado ao curso (cria um com o nome do curso se não houver). */
    forCourse(courseId: number): Promise<number>
    /** Abre o seletor de arquivo e importa .apkg/.txt; `null` se cancelar. */
    importFile(): Promise<ImportResult | null>
  }
  cards: {
    create(input: NewCard): Promise<CardView>
    update(id: number, patch: { front: string; back: string }): Promise<CardView>
    delete(id: number): Promise<void>
    reset(id: number): Promise<void>
  }
  study: {
    next(deckId: number): Promise<StudyNext>
    answer(cardId: number, rating: Rating, durationMs: number): Promise<void>
  }
  tasks: {
    list(): Promise<Task[]>
    create(input: TaskInput): Promise<Task>
    update(id: number, input: TaskInput): Promise<Task>
    /** Arrastar e soltar: coluna e posição dentro dela. */
    move(id: number, status: TaskStatus, index: number): Promise<void>
    setDone(id: number, done: boolean): Promise<void>
    delete(id: number): Promise<void>
    today(): Promise<Task[]>
    calendar(from: string, to: string): Promise<CalendarDay[]>
  }
  /** Tela Progresso: estatísticas acumuladas e histórico. */
  stats: {
    get(): Promise<ProgressData>
    history(filter: HistoryFilter): Promise<HistoryEntry[]>
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
