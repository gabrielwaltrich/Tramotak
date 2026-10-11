/** Contratos de IPC compartilhados entre main, preload e renderer. */
export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
}

export const IPC = {
  appInfo: 'app:info'
} as const

export interface TramotakApi {
  app: {
    info(): Promise<AppInfo>
  }
}
