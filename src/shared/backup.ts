/** Backup do banco e pacotes de estudo (exportar/importar). */

export interface BackupCounts {
  courses: number
  lessons: number
  notes: number
  cards: number
  questions: number
  pages: number
  mindmaps: number
}

export interface BackupInfo {
  path: string
  name: string
  bytes: number
  modifiedAt: number
  schemaVersion: number
  counts: BackupCounts
}

export interface BackupEntry {
  name: string
  bytes: number
  modifiedAt: number
  /** auto = diário; pre-restore = estado guardado antes de uma restauração. */
  kind: 'auto' | 'pre-restore' | 'manual'
}

// ── Pacotes ─────────────────────────────────────────────────────────────────

export const PACKAGE_FORMAT = 'tramotak-package'
export const PACKAGE_VERSION = 1
export const PACKAGE_EXT = 'tramotak'

/** O que escolher para exportar (ids locais). */
export interface ExportSelection {
  courseIds: number[]
  deckIds: number[]
  bankIds: number[]
  notebookIds: number[]
  mindmapIds: number[]
  /** Agendamento das cartas (para continuar de onde parou); sem ele, entram como novas. */
  includeSchedule: boolean
  /** Progresso das aulas (posição, concluídas, favoritas) além das anotações e transcrições. */
  includeProgress: boolean
}

/** Itens disponíveis para exportar. */
export interface ExportCatalog {
  courses: { id: number; title: string; notes: number; transcripts: number; completed: number }[]
  decks: { id: number; title: string; cards: number }[]
  banks: { id: number; title: string; questions: number }[]
  notebooks: { id: number; title: string; pages: number }[]
  mindmaps: { id: number; title: string; nodes: number }[]
}

/** Resumo de um pacote aberto para importar. */
export interface PackagePreview {
  token: string
  createdAt: number
  appVersion: string
  courses: { key: string; title: string; lessons: number; notes: number; transcripts: number; progress: number; withData: boolean; match: number | null }[]
  decks: { title: string; cards: number }[]
  banks: { title: string; questions: number }[]
  notebooks: { title: string; pages: number }[]
  mindmaps: { title: string }[]
}

export interface ImportRequest {
  token: string
  /** Curso local de cada curso do pacote (chave → id), ou `null` para não ligar. */
  courseMap: Record<string, number | null>
}

export interface PackageImportResult {
  decks: number
  cards: number
  banks: number
  questions: number
  notebooks: number
  mindmaps: number
  notes: number
  progress: number
  transcripts: number
  /** Ligações a aulas que não acharam o curso/aula correspondente. */
  unlinked: number
}
