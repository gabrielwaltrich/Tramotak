import { parseMediaUrl } from '@shared/media'
import type { PipCommand, PipSettings, Rect } from '@shared/pip'

/** Argumento que faz o executável do app abrir só a janela flutuante (processo separado, em X11). */
export const PIP_CHILD_FLAG = '--tramotak-pip'

/** Arquivo que a janela flutuante pode tocar: caminho no disco ou conteúdo pronto (transcrição em WebVTT). */
export type PipMedia = { path: string } | { body: string; type: string }

/** Chave `tipo/id` das URLs do protocolo de mídia (sem a versão). */
export type PipMediaMap = Record<string, PipMedia>

export function mediaKey(url: string): string | null {
  const target = parseMediaUrl(url)
  return target ? `${target.type}/${target.id}` : null
}

/** Do app para o processo da janela flutuante. */
export type ToPipProcess =
  | { kind: 'open'; settings: PipSettings; savedBounds: unknown }
  | { kind: 'media'; files: PipMediaMap }
  | { kind: 'command'; command: PipCommand }
  | { kind: 'close' }

/** Do processo da janela flutuante para o app. */
export type FromPipProcess =
  | { kind: 'hello' }
  | { kind: 'event'; event: unknown }
  | { kind: 'bounds'; rect: Rect }
  | { kind: 'closed' }
