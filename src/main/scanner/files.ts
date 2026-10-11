import { extname } from 'node:path'

export const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi', '.wmv', '.flv'])
/** Contêineres que o Chromium costuma não tocar ou toca só com certos codecs. */
export const RISKY_VIDEO_EXTS = new Set(['.mkv', '.mov', '.avi', '.wmv', '.flv'])
export const TEXT_EXTS = new Set(['.md', '.markdown', '.html', '.htm', '.txt'])
export const SUBTITLE_EXTS = new Set(['.srt', '.vtt'])
export const DOCUMENT_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods',
  '.csv', '.zip', '.rar', '.7z', '.epub', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp3', '.m4a', '.wav', '.ogg', '.py', '.js', '.ts', '.json', '.ipynb', '.sql'
])

const JUNK = new Set(['thumbs.db', 'desktop.ini', '.ds_store', 'icon\r'])

export type FileClass = 'video' | 'text' | 'subtitle' | 'document' | 'ignored'

export function isIgnored(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || JUNK.has(name.toLowerCase())
}

export function classify(name: string): FileClass {
  if (isIgnored(name)) return 'ignored'
  const ext = extname(name).toLowerCase()
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (SUBTITLE_EXTS.has(ext)) return 'subtitle'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (DOCUMENT_EXTS.has(ext)) return 'document'
  return 'ignored'
}
