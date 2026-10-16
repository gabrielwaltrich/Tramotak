import { contextBridge, ipcRenderer } from 'electron'
// Só tipos e as constantes de pip.ts: o preload roda em sandbox e não pode depender de pedaços divididos com o
// preload principal (por isso nada de @shared/ipc aqui).
import { PIP_CHANNELS, type PipCommand, type PipWindowApi } from '@shared/pip'

const api: PipWindowApi = {
  emit: (event) => ipcRenderer.send(PIP_CHANNELS.event, event),
  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => command && typeof command === 'object' && callback(command as PipCommand)
    ipcRenderer.on(PIP_CHANNELS.command, listener)
    return () => ipcRenderer.removeListener(PIP_CHANNELS.command, listener)
  },
  setOpacity: (value) => ipcRenderer.send(PIP_CHANNELS.opacity, value),
  moveTo: (x, y) => ipcRenderer.send(PIP_CHANNELS.move, x, y),
  setBounds: (rect) => ipcRenderer.send(PIP_CHANNELS.bounds, rect),
  getBounds: () => ipcRenderer.invoke(PIP_CHANNELS.getBounds)
}

contextBridge.exposeInMainWorld('pip', api)
