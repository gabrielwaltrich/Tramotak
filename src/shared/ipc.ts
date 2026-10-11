/** Contratos de IPC compartilhados entre main, preload e renderer. */
import type { DeckDetail, DeckSummary, CardView, ImportResult, NewCard, StudyNext } from './flashcards'
import type { Rating } from './srs'
import type { CalendarDay, Task, TaskInput, TaskStatus } from './planner'
import type { HistoryEntry, HistoryFilter, ProgressData } from './progress'
import type { AttemptAnswerState, AttemptView, BankAnalytics, BankSummary, Exam, ExamSelection, ExamSettings } from './exams'
import type { Question, QuestionAnswer, QuestionInput } from './questions'
import type { NotebookDetail, NotebookSummary, Page } from './notebooks'
import type { MindMapData } from './mindmap'
import type { Compatibility, MediaJob, MediaJobKind, Transcript } from './media'
import type { BackupEntry, BackupInfo, ExportCatalog, ExportSelection, ImportRequest as PackageImportRequest, PackageImportResult, PackagePreview } from './backup'
import type { AiGenerateRequest, AiGenerateResponse, AiLink, AiModelInfo, AiModels, AiProvider, AiSource, AiSourceRef, ChatMaterialInfo, ChatMessage, ChatSendRequest } from './ai'
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
  /** Parâmetros do FFmpeg para a conversão completa de vídeos. */
  conversionArgs: string
  transcriptionProvider: 'none' | 'groq' | 'local'
  transcriptionModel: string
  /** Código ISO ("pt") ou vazio para o provedor detectar. */
  transcriptionLanguage: string
  /** Base de um servidor Whisper compatível com a API da OpenAI (…/v1). */
  localWhisperUrl: string
  /** Provedor de IA usado para gerar cartas, questões, resumos e mapas. */
  aiProvider: 'none' | AiProvider
  /** Modelo escolhido em cada provedor. */
  aiModels: AiModels
  /** Endereço do Ollama. */
  ollamaUrl: string
  /** Base de uma API compatível com a da OpenAI (…/v1). */
  openaiBaseUrl: string
  /** Backup automático diário na pasta do app (guarda os 7 mais recentes). */
  autoBackup: boolean
  /** Deixa a IA pesquisar na internet (gerar e conversar), nos provedores que permitem. */
  aiWebSearch: boolean
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
  statsHistory: 'stats:history',
  banksList: 'banks:list',
  banksGet: 'banks:get',
  banksCreate: 'banks:create',
  banksUpdate: 'banks:update',
  banksDelete: 'banks:delete',
  banksImport: 'banks:import',
  banksExport: 'banks:export',
  banksTopics: 'banks:topics',
  banksAnalytics: 'banks:analytics',
  questionsList: 'questions:list',
  questionsCreate: 'questions:create',
  questionsUpdate: 'questions:update',
  questionsDelete: 'questions:delete',
  examsList: 'exams:list',
  examsCreate: 'exams:create',
  examsDelete: 'exams:delete',
  attemptsStart: 'attempts:start',
  attemptsGet: 'attempts:get',
  attemptsAnswer: 'attempts:answer',
  attemptsMark: 'attempts:mark',
  attemptsFocusLoss: 'attempts:focusLoss',
  attemptsSubmit: 'attempts:submit',
  attemptsGradeEssay: 'attempts:gradeEssay',
  attemptsDelete: 'attempts:delete',
  notebooksList: 'notebooks:list',
  notebooksGet: 'notebooks:get',
  notebooksCreate: 'notebooks:create',
  notebooksRename: 'notebooks:rename',
  notebooksDelete: 'notebooks:delete',
  notebooksPages: 'notebooks:pages',
  notebooksExportPdf: 'notebooks:exportPdf',
  pagesGet: 'pages:get',
  pagesCreate: 'pages:create',
  pagesSave: 'pages:save',
  pagesMove: 'pages:move',
  pagesDelete: 'pages:delete',
  mindmapsList: 'mindmaps:list',
  mindmapsGet: 'mindmaps:get',
  mindmapsCreate: 'mindmaps:create',
  mindmapsSave: 'mindmaps:save',
  mindmapsDelete: 'mindmaps:delete',
  mindmapsImport: 'mindmaps:import',
  filesSave: 'files:save',
  mediaJobs: 'media:jobs',
  mediaJobsChanged: 'media:jobsChanged',
  mediaEnqueue: 'media:enqueue',
  mediaCancel: 'media:cancel',
  mediaClearFinished: 'media:clearFinished',
  mediaProbe: 'media:probe',
  mediaCheckCourse: 'media:checkCourse',
  mediaRemoveConversion: 'media:removeConversion',
  mediaStorage: 'media:storage',
  transcriptGet: 'transcript:get',
  transcriptDelete: 'transcript:delete',
  secretsSetGroqKey: 'secrets:setGroqKey',
  secretsHasGroqKey: 'secrets:hasGroqKey',
  openFfmpegLicense: 'app:openFfmpegLicense',
  secretsSetAiKey: 'secrets:setAiKey',
  secretsAiKeys: 'secrets:aiKeys',
  aiModels: 'ai:models',
  aiSource: 'ai:source',
  aiGenerate: 'ai:generate',
  aiCancel: 'ai:cancel',
  aiOpenLink: 'ai:openLink',
  aiLoginOpenRouter: 'ai:loginOpenRouter',
  aiCancelLogin: 'ai:cancelLogin',
  aiOllamaStatus: 'ai:ollamaStatus',
  aiOllamaPull: 'ai:ollamaPull',
  aiOllamaPullCancel: 'ai:ollamaPullCancel',
  aiOllamaPullProgress: 'ai:ollamaPullProgress',
  coursesRelocate: 'courses:relocate',
  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupOpenFolder: 'backup:openFolder',
  backupInspectFile: 'backup:inspectFile',
  backupInspect: 'backup:inspect',
  backupRestore: 'backup:restore',
  packageCatalog: 'package:catalog',
  packageExport: 'package:export',
  packageOpen: 'package:open',
  packageImport: 'package:import',
  aiChatGet: 'ai:chatGet',
  aiChatSend: 'ai:chatSend',
  aiChatCancel: 'ai:chatCancel',
  aiChatClear: 'ai:chatClear',
  aiChatDelta: 'ai:chatDelta'
} as const

export interface OllamaPullState {
  model: string
  status: string
  fraction: number | null
  done: boolean
  error: string | null
}

export interface MindMapSummary {
  id: number
  title: string
  nodeCount: number
  updatedAt: number
}

export interface MindMapDoc extends MindMapSummary {
  data: MindMapData
}

export interface SaveFileRequest {
  title: string
  defaultName: string
  filters: { name: string; extensions: string[] }[]
  content: string
  encoding: 'utf8' | 'base64'
}

export interface QuestionImportResult {
  bankId: number
  bankTitle: string
  imported: number
  skipped: number
}

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
    openFfmpegLicense(): Promise<void>
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
  banks: {
    list(): Promise<BankSummary[]>
    get(id: number): Promise<BankSummary>
    create(input: { title: string; description?: string }): Promise<number>
    update(id: number, patch: { title: string; description: string }): Promise<void>
    delete(id: number): Promise<void>
    /** Abre o seletor e importa .json/.csv/.gift; `bankId` nulo cria um banco novo. `null` se cancelar. */
    importFile(bankId: number | null): Promise<QuestionImportResult | null>
    /** Abre "Salvar como"; o formato vem da extensão escolhida. Devolve o caminho ou `null`. */
    exportFile(bankId: number): Promise<string | null>
    topics(bankId: number): Promise<string[]>
    analytics(bankId: number): Promise<BankAnalytics>
  }
  questions: {
    list(bankId: number): Promise<Question[]>
    create(bankId: number, input: QuestionInput): Promise<Question>
    update(id: number, input: QuestionInput): Promise<Question>
    delete(id: number): Promise<void>
  }
  exams: {
    list(bankId: number): Promise<Exam[]>
    create(bankId: number, input: { title: string; settings?: Partial<ExamSettings>; selection: ExamSelection }): Promise<number>
    delete(id: number): Promise<void>
  }
  attempts: {
    /** Começa (ou retoma a tentativa aberta) e devolve o id. */
    start(examId: number): Promise<number>
    get(id: number): Promise<AttemptView>
    answer(id: number, questionId: number, answer: QuestionAnswer | null): Promise<AttemptAnswerState>
    mark(id: number, questionId: number, marked: boolean): Promise<void>
    focusLoss(id: number): Promise<number>
    submit(id: number): Promise<void>
    gradeEssay(id: number, questionId: number, correct: boolean): Promise<void>
    delete(id: number): Promise<void>
  }
  notebooks: {
    list(): Promise<NotebookSummary[]>
    get(id: number): Promise<NotebookDetail>
    create(title: string): Promise<number>
    rename(id: number, title: string): Promise<void>
    delete(id: number): Promise<void>
    /** Todas as páginas com conteúdo (leitura contínua e PDF). */
    pages(id: number): Promise<Page[]>
    /** Recebe o HTML pronto do caderno, imprime em PDF e abre "Salvar como". Devolve o caminho ou `null`. */
    exportPdf(id: number, html: string): Promise<string | null>
  }
  pages: {
    get(id: number): Promise<Page>
    create(notebookId: number): Promise<Page>
    save(id: number, input: { title: string; blocks: unknown }): Promise<number>
    move(id: number, index: number): Promise<void>
    delete(id: number): Promise<void>
  }
  mindmaps: {
    list(): Promise<MindMapSummary[]>
    get(id: number): Promise<MindMapDoc>
    create(title: string): Promise<number>
    save(id: number, input: { title: string; data: MindMapData }): Promise<number>
    delete(id: number): Promise<void>
    /** Abre um .json exportado e cria um mapa novo. `null` se cancelar. */
    importFile(): Promise<number | null>
  }
  files: {
    /** Abre no aplicativo padrão do sistema. */
    openLesson(id: number): Promise<void>
    openAsset(id: number): Promise<void>
    showLesson(id: number): Promise<void>
    /** "Salvar como" genérico. Devolve o caminho escolhido ou `null`. */
    save(request: SaveFileRequest): Promise<string | null>
  }
  media: {
    jobs(): Promise<MediaJob[]>
    /** Avisa quando a fila muda (progresso, conclusão). Devolve o "desinscrever". */
    onJobs(callback: (jobs: MediaJob[]) => void): () => void
    enqueue(kind: MediaJobKind, lessonId: number): Promise<MediaJob>
    cancel(id: number): Promise<void>
    clearFinished(): Promise<void>
    probe(lessonId: number): Promise<Compatibility & { converted: boolean }>
    checkCourse(courseId: number): Promise<{ checked: number; incompatible: { lessonId: number; title: string; reason: string; plan: string }[] }>
    removeConversion(lessonId: number): Promise<void>
    /** Espaço das cópias convertidas; com `clean`, apaga as que nenhuma aula usa. */
    storage(clean: boolean): Promise<{ files: number; bytes: number; removed: number }>
  }
  transcripts: {
    get(lessonId: number): Promise<Transcript | null>
    delete(lessonId: number): Promise<void>
  }
  secrets: {
    /** Guarda (cifrada pelo sistema) ou remove (`null`) a chave do Groq. Ela nunca volta para a interface. */
    setGroqKey(key: string | null): Promise<void>
    hasGroqKey(): Promise<boolean>
    /** Guarda ou remove (`null`) a chave de um provedor de IA. Ela nunca volta para a interface. */
    setAiKey(provider: AiProvider, key: string | null): Promise<void>
    /** Quais provedores têm chave salva. */
    aiKeys(): Promise<Record<AiProvider, boolean>>
  }
  ai: {
    /** Modelos disponíveis no provedor (testa a conexão e a chave). */
    models(provider: AiProvider): Promise<AiModelInfo[]>
    /** Junta o material de uma aula ou página de caderno. */
    source(ref: AiSourceRef): Promise<AiSource>
    /** Gera com o provedor configurado. Um pedido por vez. */
    generate(request: AiGenerateRequest): Promise<AiGenerateResponse>
    cancel(): Promise<void>
    /** Abre no navegador uma das páginas conhecidas (criar chave, baixar o Ollama). */
    openLink(link: AiLink): Promise<void>
    /** Login do OpenRouter pelo navegador; a chave da conta fica guardada cifrada. */
    loginOpenRouter(): Promise<void>
    cancelLogin(): Promise<void>
    ollamaStatus(): Promise<{ version: string | null }>
    /** Baixa um modelo no Ollama; o progresso chega por `onPullProgress`. */
    ollamaPull(model: string): Promise<void>
    ollamaPullCancel(): Promise<void>
    onPullProgress(callback: (p: OllamaPullState) => void): () => void
    /** Conversa salva da aula e o que ela tem como base (transcrição, legenda, texto). */
    chatGet(lessonId: number, includeNotes: boolean): Promise<{ messages: ChatMessage[]; material: ChatMaterialInfo }>
    /** Pergunta; o texto chega aos pedaços por `onChatDelta` e a resposta completa volta no fim. */
    chatSend(request: ChatSendRequest): Promise<ChatMessage>
    chatCancel(): Promise<void>
    chatClear(lessonId: number): Promise<void>
    onChatDelta(callback: (delta: { lessonId: number; text: string }) => void): () => void
  }
  backup: {
    /** "Salvar como" e cria um backup completo (sem as chaves de API). `null` se cancelar. */
    create(): Promise<{ path: string; bytes: number } | null>
    list(): Promise<{ dir: string; backups: BackupEntry[] }>
    openFolder(): Promise<void>
    /** Escolhe um arquivo de backup e mostra o que tem nele. `null` se cancelar. */
    inspectFile(): Promise<BackupInfo | null>
    inspect(name: string): Promise<BackupInfo>
    /** Restaura (backup da pasta do app pelo nome, ou o arquivo inspecionado com `null`) e reinicia o app. */
    restore(name: string | null): Promise<{ relaunch: boolean }>
  }
  packages: {
    catalog(): Promise<ExportCatalog>
    /** Monta o pacote e abre "Salvar como". `null` se cancelar. */
    export(selection: ExportSelection): Promise<{ path: string; bytes: number } | null>
    /** Abre um pacote e devolve o resumo para confirmar. `null` se cancelar. */
    open(): Promise<PackagePreview | null>
    import(request: PackageImportRequest): Promise<PackageImportResult>
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
    /** Aponta o curso para outra pasta (ex.: depois de restaurar em outro computador). `null` se cancelar. */
    relocate(id: number): Promise<(RevalidateResult & { kept: number }) | null>
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
  notes: {
    list(lessonId: number): Promise<Note[]>
    create(input: { lessonId: number; timestampSec: number | null; body: string }): Promise<Note>
    update(id: number, body: string): Promise<Note>
    delete(id: number): Promise<void>
  }
}
