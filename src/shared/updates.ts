/** Atualizações do app: estados mostrados na interface e comparação de versões. */

/**
 * Como esta instalação se atualiza:
 * - `auto`: baixa e instala sozinha ao reiniciar (instalador do Windows, AppImage e .deb do Linux);
 * - `notify`: só avisa e leva à página da versão (.exe portátil; macOS, que não é mais suportado);
 * - `dev`: rodando a partir do código-fonte (não procura).
 */
export type UpdateMode = 'auto' | 'notify' | 'dev'

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none'; checkedAt: number }
  | { status: 'available'; version: string; url: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export interface UpdateInfo {
  mode: UpdateMode
  current: string
  state: UpdateState
  /** Instalar pede a senha do sistema (.deb no Linux). */
  needsPassword: boolean
}

export const RELEASES_URL = 'https://github.com/gabrielwaltrich/Tramotak/releases'

/** Compara versões "1.2.3" (ignora o "v" e sufixos como "-beta"). Positivo se `a` for mais nova. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
