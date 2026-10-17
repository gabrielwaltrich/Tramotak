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

// ── Pasta de backup (Drive, Dropbox, pendrive) ──────────────────────────────

/** Backups automáticos gravados pelo app na pasta escolhida (só estes são apagados ao passar de 7). */
export const FOLDER_AUTO_PREFIX = 'Tramotak-auto-'
export const FOLDER_KEEP = 7
/** Sem conseguir gravar na pasta por tanto tempo, o Início avisa. */
export const FOLDER_WARN_AFTER_SEC = 3 * 86_400

export interface FolderBackupStatus {
  /** Pasta escolhida, ou `null` (desligado). */
  path: string | null
  /** Último backup gravado na pasta. */
  lastAt: number | null
  lastFile: string | null
  /** Erro da última tentativa (some quando uma tentativa dá certo). */
  error: string | null
  errorAt: number | null
  /** Primeira falha desde o último sucesso (para o aviso depois de 3 dias). */
  failingSince: number | null
}

export const EMPTY_FOLDER_STATUS: FolderBackupStatus = { path: null, lastAt: null, lastFile: null, error: null, errorAt: null, failingSince: null }

/** Aviso do Início: pasta escolhida e nenhum backup gravado nela há 3 dias ou mais. */
export function folderBackupWarning(status: FolderBackupStatus, nowSec: number): boolean {
  return status.path !== null && status.error !== null && status.failingSince !== null && nowSec - status.failingSince >= FOLDER_WARN_AFTER_SEC
}

/** Onde está o backup a inspecionar/restaurar: pasta do app ou pasta escolhida. */
export type BackupPlace = 'app' | 'folder'

export interface BackupListing {
  dir: string
  backups: BackupEntry[]
  folder: FolderBackupStatus & {
    backups: BackupEntry[]
    /** A pasta não pôde ser lida agora (desconectada, sem permissão). */
    listError: string | null
  }
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
