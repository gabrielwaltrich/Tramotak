import type { PipWindowApi } from '../shared/pip'

declare global {
  interface Window {
    /** Só existe na janela flutuante. */
    pip: PipWindowApi
  }
}
