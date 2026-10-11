/** Tipos do domínio de cursos, compartilhados entre main e renderer. */

/** Como o scanner interpreta a hierarquia de pastas. */
export type Structure = 'auto' | 'flat' | 'modules' | 'submodules'

/** Como o prefixo numérico é removido do título exibido. */
export type Numbering = 'dot' | 'dash' | 'none'

export type LessonKind = 'video' | 'text' | 'document'
export type AssetKind = 'subtitle' | 'attachment'

export interface ScannedAsset {
  kind: AssetKind
  relPath: string
  /** Idioma da legenda, extraído do sufixo (`aula.pt-BR.srt` → `pt-BR`). */
  lang: string | null
}

export interface ScannedLesson {
  title: string
  relPath: string
  kind: LessonKind
  size: number
  mtimeMs: number
  assets: ScannedAsset[]
}

export interface ScannedModule {
  title: string
  relPath: string
  lessons: ScannedLesson[]
  children: ScannedModule[]
}

export type ScanWarningCode =
  | 'empty'
  | 'maybe-unsupported'
  | 'flattened'
  | 'long-path'
  | 'unreadable'

export interface ScanWarning {
  code: ScanWarningCode
  message: string
  relPath?: string
}

export interface ScanStats {
  modules: number
  lessons: number
  videos: number
  subtitles: number
  attachments: number
  totalBytes: number
}

export interface ScanResult {
  /** Estrutura efetivamente aplicada (no modo `auto`, a que foi detectada). */
  structure: Exclude<Structure, 'auto'>
  /** Aulas que ficam direto na raiz do curso, fora de qualquer módulo. */
  lessons: ScannedLesson[]
  modules: ScannedModule[]
  warnings: ScanWarning[]
  stats: ScanStats
}

export interface ScanOptions {
  structure: Structure
  numbering: Numbering
}
