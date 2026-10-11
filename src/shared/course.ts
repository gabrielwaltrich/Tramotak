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

/** Cartão de curso em Meus Cursos. */
export interface CourseSummary {
  id: number
  title: string
  description: string
  rootPath: string
  lessonCount: number
  completedCount: number
  /** Soma das durações conhecidas (as durações são lidas no primeiro play). */
  durationSec: number
  createdAt: number
  lastOpenedAt: number | null
  /** Aula para o botão "Continuar": a última assistida ou a primeira do curso. */
  resumeLessonId: number | null
}

export type CourseSort = 'recent' | 'title' | 'progress'

export interface ImportRequest {
  path: string
  title: string
  structure: Structure
  numbering: Numbering
}

export interface PreviewResponse {
  scan: ScanResult
  suggestedTitle: string
  /** Curso já importado a partir desta mesma pasta, se houver. */
  existingCourseId: number | null
}

export interface RevalidateResult {
  added: number
  removed: number
  updated: number
}

export interface CourseLesson {
  id: number
  title: string
  relPath: string
  kind: LessonKind
  durationSec: number | null
  completed: boolean
}

export interface CourseModuleNode {
  id: number
  title: string
  lessons: CourseLesson[]
  children: CourseModuleNode[]
}

export interface CourseDetail extends CourseSummary {
  structure: Exclude<Structure, 'auto'>
  lessons: CourseLesson[]
  modules: CourseModuleNode[]
}

export interface LessonAssetView {
  id: number
  kind: AssetKind
  name: string
  lang: string | null
  /** URL no protocolo do app (legendas já chegam como WebVTT). */
  url: string
}

export interface LessonNeighbor {
  id: number
  title: string
}

export interface LessonView {
  id: number
  title: string
  kind: LessonKind
  relPath: string
  /** URL do arquivo da aula no protocolo do app. */
  url: string
  durationSec: number | null
  course: { id: number; title: string }
  moduleTitle: string | null
  assets: LessonAssetView[]
  progress: { positionSec: number; completed: boolean; favorite: boolean }
  prev: LessonNeighbor | null
  next: LessonNeighbor | null
}

export interface ProgressUpdate {
  lessonId: number
  positionSec: number
  durationSec: number | null
  /** Segundos efetivamente assistidos desde o último envio (alimenta o tempo de estudo). */
  watchedSec: number
}

export interface Note {
  id: number
  lessonId: number
  /** Segundo do vídeo em que a nota foi criada; `null` em aulas sem vídeo. */
  timestampSec: number | null
  body: string
  createdAt: number
  updatedAt: number
}

export interface ContinueLesson {
  lessonId: number
  title: string
  kind: LessonKind
  courseId: number
  courseTitle: string
  moduleTitle: string | null
  positionSec: number
  durationSec: number | null
  /** A última aula vista já foi concluída e esta é a seguinte. */
  isNext: boolean
}

export interface DashboardData {
  todaySeconds: number
  goalMinutes: number
  lessonsCompletedToday: number
  streak: { current: number; todayDone: boolean; best: number }
  continueLesson: ContinueLesson | null
  /** Flashcards para estudar hoje, somando todos os baralhos. */
  cardsDueToday: number
}

export type SearchKind = 'course' | 'module' | 'lesson' | 'note' | 'card' | 'question'

/**
 * Resultado da busca global. `title` e `snippet` trazem os trechos encontrados entre
 * `HL_START` e `HL_END` (caracteres de controle; a interface os troca por destaque).
 */
export interface SearchHit {
  kind: SearchKind
  id: number
  title: string
  snippet: string | null
  courseId: number
  courseTitle: string
  moduleTitle: string | null
  lessonId: number | null
  lessonKind: LessonKind | null
  timestampSec: number | null
  /** Só para cartas. Em cartas, `courseId`/`courseTitle` vêm da aula ligada (ou 0/vazio). */
  deckId: number | null
  deckTitle: string | null
  /** Só para questões. */
  bankId: number | null
  bankTitle: string | null
}

export const HL_START = '\u0001'
export const HL_END = '\u0002'
