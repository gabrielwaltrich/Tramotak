import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TramotakApi } from '@shared/ipc'

const api: TramotakApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openDataFolder: () => ipcRenderer.invoke(IPC.filesOpenDataFolder)
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
    revalidate: (id) => ipcRenderer.invoke(IPC.coursesRevalidate, id)
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
    showLesson: (id) => ipcRenderer.invoke(IPC.filesShowLesson, id)
  },
  notes: {
    list: (lessonId) => ipcRenderer.invoke(IPC.notesList, lessonId),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (id, body) => ipcRenderer.invoke(IPC.notesUpdate, id, body),
    delete: (id) => ipcRenderer.invoke(IPC.notesDelete, id)
  }
}

contextBridge.exposeInMainWorld('api', api)
