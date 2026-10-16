export type PipMode = 'window' | 'process'

/**
 * No Wayland a janela não fica por cima sozinha (o GNOME não oferece isso aos apps): a janela flutuante vira um
 * processo separado em X11, se houver XWayland. No Windows e em sessões X11, é uma janela comum do próprio app.
 * `TRAMOTAK_PIP_MODE=window|process` força um dos dois (testes).
 */
export function choosePipMode(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  ozonePlatform: string
): { mode: PipMode; onTop: boolean } {
  const forced = env.TRAMOTAK_PIP_MODE
  if (forced === 'window' || forced === 'process') return { mode: forced, onTop: true }
  const wayland = platform === 'linux' && ozonePlatform !== 'x11' && env.XDG_SESSION_TYPE === 'wayland' && !!env.WAYLAND_DISPLAY
  if (!wayland) return { mode: 'window', onTop: true }
  return env.DISPLAY ? { mode: 'process', onTop: true } : { mode: 'window', onTop: false }
}
