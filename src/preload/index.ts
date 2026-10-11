import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TramotakApi } from '@shared/ipc'

const api: TramotakApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openDataFolder: () => ipcRenderer.invoke(IPC.filesOpenDataFolder),
    onNavigate: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, path: unknown) => {
        if (typeof path === 'string' && path.startsWith('/')) callback(path)
      }
      ipcRenderer.on(IPC.navigate, listener)
      return () => ipcRenderer.removeListener(IPC.navigate, listener)
    },
    openFfmpegLicense: () => ipcRenderer.invoke(IPC.openFfmpegLicense)
  },
  media: {
    jobs: () => ipcRenderer.invoke(IPC.mediaJobs),
    onJobs: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, jobs: unknown) => Array.isArray(jobs) && callback(jobs)
      ipcRenderer.on(IPC.mediaJobsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.mediaJobsChanged, listener)
    },
    enqueue: (kind, lessonId) => ipcRenderer.invoke(IPC.mediaEnqueue, kind, lessonId),
    cancel: (id) => ipcRenderer.invoke(IPC.mediaCancel, id),
    clearFinished: () => ipcRenderer.invoke(IPC.mediaClearFinished),
    probe: (lessonId) => ipcRenderer.invoke(IPC.mediaProbe, lessonId),
    checkCourse: (courseId) => ipcRenderer.invoke(IPC.mediaCheckCourse, courseId),
    removeConversion: (lessonId) => ipcRenderer.invoke(IPC.mediaRemoveConversion, lessonId),
    storage: (clean) => ipcRenderer.invoke(IPC.mediaStorage, clean)
  },
  transcripts: {
    get: (lessonId) => ipcRenderer.invoke(IPC.transcriptGet, lessonId),
    delete: (lessonId) => ipcRenderer.invoke(IPC.transcriptDelete, lessonId)
  },
  secrets: {
    setGroqKey: (key) => ipcRenderer.invoke(IPC.secretsSetGroqKey, key),
    hasGroqKey: () => ipcRenderer.invoke(IPC.secretsHasGroqKey),
    setAiKey: (provider, key) => ipcRenderer.invoke(IPC.secretsSetAiKey, provider, key),
    aiKeys: () => ipcRenderer.invoke(IPC.secretsAiKeys)
  },
  ai: {
    models: (provider) => ipcRenderer.invoke(IPC.aiModels, provider),
    source: (ref) => ipcRenderer.invoke(IPC.aiSource, ref),
    generate: (request) => ipcRenderer.invoke(IPC.aiGenerate, request),
    cancel: () => ipcRenderer.invoke(IPC.aiCancel),
    openLink: (link) => ipcRenderer.invoke(IPC.aiOpenLink, link),
    loginOpenRouter: () => ipcRenderer.invoke(IPC.aiLoginOpenRouter),
    cancelLogin: () => ipcRenderer.invoke(IPC.aiCancelLogin),
    ollamaStatus: () => ipcRenderer.invoke(IPC.aiOllamaStatus),
    ollamaPull: (model) => ipcRenderer.invoke(IPC.aiOllamaPull, model),
    ollamaPullCancel: () => ipcRenderer.invoke(IPC.aiOllamaPullCancel),
    chatGet: (lessonId, includeNotes) => ipcRenderer.invoke(IPC.aiChatGet, lessonId, includeNotes),
    chatSend: (request) => ipcRenderer.invoke(IPC.aiChatSend, request),
    chatCancel: () => ipcRenderer.invoke(IPC.aiChatCancel),
    chatClear: (lessonId) => ipcRenderer.invoke(IPC.aiChatClear, lessonId),
    onChatDelta: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, delta: unknown) => delta && typeof delta === 'object' && callback(delta as never)
      ipcRenderer.on(IPC.aiChatDelta, listener)
      return () => ipcRenderer.removeListener(IPC.aiChatDelta, listener)
    },
    onPullProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => state && typeof state === 'object' && callback(state as never)
      ipcRenderer.on(IPC.aiOllamaPullProgress, listener)
      return () => ipcRenderer.removeListener(IPC.aiOllamaPullProgress, listener)
    }
  },
  dashboard: {
    get: () => ipcRenderer.invoke(IPC.dashboardGet)
  },
  search: {
    query: (text) => ipcRenderer.invoke(IPC.searchQuery, text)
  },
  decks: {
    list: () => ipcRenderer.invoke(IPC.decksList),
    get: (id) => ipcRenderer.invoke(IPC.decksGet, id),
    create: (input) => ipcRenderer.invoke(IPC.decksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.decksUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.decksDelete, id),
    forCourse: (courseId) => ipcRenderer.invoke(IPC.decksForCourse, courseId),
    importFile: () => ipcRenderer.invoke(IPC.decksImport)
  },
  cards: {
    create: (input) => ipcRenderer.invoke(IPC.cardsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.cardsUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.cardsDelete, id),
    reset: (id) => ipcRenderer.invoke(IPC.cardsReset, id)
  },
  study: {
    next: (deckId) => ipcRenderer.invoke(IPC.studyNext, deckId),
    answer: (cardId, rating, durationMs) => ipcRenderer.invoke(IPC.studyAnswer, cardId, rating, durationMs)
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    create: (input) => ipcRenderer.invoke(IPC.tasksCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.tasksUpdate, id, input),
    move: (id, status, index) => ipcRenderer.invoke(IPC.tasksMove, id, status, index),
    setDone: (id, done) => ipcRenderer.invoke(IPC.tasksSetDone, id, done),
    delete: (id) => ipcRenderer.invoke(IPC.tasksDelete, id),
    today: () => ipcRenderer.invoke(IPC.tasksToday),
    calendar: (from, to) => ipcRenderer.invoke(IPC.calendarRange, from, to)
  },
  banks: {
    list: () => ipcRenderer.invoke(IPC.banksList),
    get: (id) => ipcRenderer.invoke(IPC.banksGet, id),
    create: (input) => ipcRenderer.invoke(IPC.banksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.banksUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.banksDelete, id),
    importFile: (bankId) => ipcRenderer.invoke(IPC.banksImport, bankId),
    exportFile: (bankId) => ipcRenderer.invoke(IPC.banksExport, bankId),
    topics: (bankId) => ipcRenderer.invoke(IPC.banksTopics, bankId),
    analytics: (bankId) => ipcRenderer.invoke(IPC.banksAnalytics, bankId)
  },
  questions: {
    list: (bankId) => ipcRenderer.invoke(IPC.questionsList, bankId),
    create: (bankId, input) => ipcRenderer.invoke(IPC.questionsCreate, bankId, input),
    update: (id, input) => ipcRenderer.invoke(IPC.questionsUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.questionsDelete, id)
  },
  exams: {
    list: (bankId) => ipcRenderer.invoke(IPC.examsList, bankId),
    create: (bankId, input) => ipcRenderer.invoke(IPC.examsCreate, bankId, input),
    delete: (id) => ipcRenderer.invoke(IPC.examsDelete, id)
  },
  attempts: {
    start: (examId) => ipcRenderer.invoke(IPC.attemptsStart, examId),
    get: (id) => ipcRenderer.invoke(IPC.attemptsGet, id),
    answer: (id, questionId, answer) => ipcRenderer.invoke(IPC.attemptsAnswer, id, questionId, answer),
    mark: (id, questionId, marked) => ipcRenderer.invoke(IPC.attemptsMark, id, questionId, marked),
    focusLoss: (id) => ipcRenderer.invoke(IPC.attemptsFocusLoss, id),
    submit: (id) => ipcRenderer.invoke(IPC.attemptsSubmit, id),
    gradeEssay: (id, questionId, correct) => ipcRenderer.invoke(IPC.attemptsGradeEssay, id, questionId, correct),
    delete: (id) => ipcRenderer.invoke(IPC.attemptsDelete, id)
  },
  stats: {
    get: () => ipcRenderer.invoke(IPC.statsGet),
    history: (filter) => ipcRenderer.invoke(IPC.statsHistory, filter)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(IPC.pickFolder)
  },
  scanner: {
    preview: (input) => ipcRenderer.invoke(IPC.preview, input)
  },
  courses: {
    import: (input) => ipcRenderer.invoke(IPC.coursesImport, input),
    list: () => ipcRenderer.invoke(IPC.coursesList),
    get: (id) => ipcRenderer.invoke(IPC.coursesGet, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.coursesUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.coursesDelete, id),
    revalidate: (id) => ipcRenderer.invoke(IPC.coursesRevalidate, id),
    relocate: (id) => ipcRenderer.invoke(IPC.coursesRelocate, id)
  },
  backup: {
    create: () => ipcRenderer.invoke(IPC.backupCreate),
    list: () => ipcRenderer.invoke(IPC.backupList),
    openFolder: () => ipcRenderer.invoke(IPC.backupOpenFolder),
    inspectFile: () => ipcRenderer.invoke(IPC.backupInspectFile),
    inspect: (name) => ipcRenderer.invoke(IPC.backupInspect, name),
    restore: (name) => ipcRenderer.invoke(IPC.backupRestore, name)
  },
  packages: {
    catalog: () => ipcRenderer.invoke(IPC.packageCatalog),
    export: (selection) => ipcRenderer.invoke(IPC.packageExport, selection),
    open: () => ipcRenderer.invoke(IPC.packageOpen),
    import: (request) => ipcRenderer.invoke(IPC.packageImport, request)
  },
  lessons: {
    get: (id) => ipcRenderer.invoke(IPC.lessonsGet, id),
    text: (id) => ipcRenderer.invoke(IPC.lessonsText, id),
    setFavorite: (id, value) => ipcRenderer.invoke(IPC.lessonsSetFavorite, id, value),
    setDuration: (id, sec) => ipcRenderer.invoke(IPC.lessonsSetDuration, id, sec)
  },
  progress: {
    save: (update) => ipcRenderer.invoke(IPC.progressSave, update),
    setCompleted: (id, value) => ipcRenderer.invoke(IPC.progressSetCompleted, id, value)
  },
  files: {
    openLesson: (id) => ipcRenderer.invoke(IPC.filesOpenLesson, id),
    openAsset: (id) => ipcRenderer.invoke(IPC.filesOpenAsset, id),
    showLesson: (id) => ipcRenderer.invoke(IPC.filesShowLesson, id),
    save: (request) => ipcRenderer.invoke(IPC.filesSave, request)
  },
  notebooks: {
    list: () => ipcRenderer.invoke(IPC.notebooksList),
    get: (id) => ipcRenderer.invoke(IPC.notebooksGet, id),
    create: (title) => ipcRenderer.invoke(IPC.notebooksCreate, title),
    rename: (id, title) => ipcRenderer.invoke(IPC.notebooksRename, id, title),
    delete: (id) => ipcRenderer.invoke(IPC.notebooksDelete, id),
    pages: (id) => ipcRenderer.invoke(IPC.notebooksPages, id),
    exportPdf: (id, html) => ipcRenderer.invoke(IPC.notebooksExportPdf, id, html)
  },
  pages: {
    get: (id) => ipcRenderer.invoke(IPC.pagesGet, id),
    create: (notebookId) => ipcRenderer.invoke(IPC.pagesCreate, notebookId),
    save: (id, input) => ipcRenderer.invoke(IPC.pagesSave, id, input),
    move: (id, index) => ipcRenderer.invoke(IPC.pagesMove, id, index),
    delete: (id) => ipcRenderer.invoke(IPC.pagesDelete, id)
  },
  mindmaps: {
    list: () => ipcRenderer.invoke(IPC.mindmapsList),
    get: (id) => ipcRenderer.invoke(IPC.mindmapsGet, id),
    create: (title) => ipcRenderer.invoke(IPC.mindmapsCreate, title),
    save: (id, input) => ipcRenderer.invoke(IPC.mindmapsSave, id, input),
    delete: (id) => ipcRenderer.invoke(IPC.mindmapsDelete, id),
    importFile: () => ipcRenderer.invoke(IPC.mindmapsImport)
  },
  notes: {
    list: (lessonId) => ipcRenderer.invoke(IPC.notesList, lessonId),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (id, body) => ipcRenderer.invoke(IPC.notesUpdate, id, body),
    delete: (id) => ipcRenderer.invoke(IPC.notesDelete, id)
  }
}

contextBridge.exposeInMainWorld('api', api)
