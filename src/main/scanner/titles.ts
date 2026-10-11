import { extname } from 'node:path'
import type { Numbering } from '@shared/course'

const PREFIX: Record<Exclude<Numbering, 'none'>, RegExp> = {
  dot: /^\s*\d+(?:\.\d+)*\s*[.)]\s*/,
  dash: /^\s*\d+(?:\.\d+)*\s*[-–—_]\s*/
}

/** Nome do arquivo/pasta sem extensão e sem o prefixo numérico do padrão escolhido. */
export function cleanTitle(name: string, numbering: Numbering, isFile = true): string {
  const base = isFile ? name.slice(0, name.length - extname(name).length) : name
  if (numbering === 'none') return base.trim() || name
  const stripped = base.replace(PREFIX[numbering], '').trim()
  // Nome que era só número ("01.mp4") continua legível.
  return stripped || base.trim() || name
}
