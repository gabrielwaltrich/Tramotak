import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TramotakApi } from '@shared/ipc'

const api: TramotakApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
