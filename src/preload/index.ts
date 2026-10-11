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
  }
}

contextBridge.exposeInMainWorld('api', api)
