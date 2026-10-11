import type { TramotakApi } from '../shared/ipc'

declare global {
  interface Window {
    api: TramotakApi
  }
}
