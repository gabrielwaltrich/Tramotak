import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TramotakApi } from '@shared/ipc'

const api: TramotakApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  }
}

contextBridge.exposeInMainWorld('api', api)
