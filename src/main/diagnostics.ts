import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { dirname, join } from 'node:path'
import { appendEntry, buildReport, isNoise, parseEntry, pruneEntries, sanitize, type LogEntry, type LogLevel, type LogSource } from '@shared/diagnostics'
import { AI_PROVIDERS } from '@shared/ai'
import { plural } from '@shared/format'
import type { Database } from './db/database'
import { getSettings } from './db/settings'
import { readFolderStatus } from './backup/folder'

/**
 * Registro de erros em `logs/erros.jsonl` (um JSON por linha), na pasta de dados. Sobrevive a um travamento e nunca
 * sai do computador sozinho: só vai no diagnóstico que a pessoa revisa e copia.
 */
export class ErrorLog {
  private entries: LogEntry[] = []

  constructor(
    private readonly file: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {
    try {
      if (existsSync(file)) {
        const parsed = readFileSync(file, 'utf8').split('\n').map(parseEntry).filter((e): e is LogEntry => e !== null)
        this.entries = pruneEntries(parsed, this.now())
        // Regrava já sem o que passou de 14 dias ou de 500 linhas.
        if (this.entries.length !== parsed.length) this.rewrite()
      }
    } catch {
      this.entries = []
    }
  }

  list(): LogEntry[] {
    return [...this.entries]
  }

  add(level: LogLevel, source: LogSource, message: string, detail?: string): void {
    const text = message.trim()
    if (!text || isNoise(text)) return
    const before = this.entries.length
    const last = this.entries[before - 1]
    this.entries = appendEntry(this.entries, { at: this.now(), level, source, message: text, ...(detail ? { detail } : {}) })
    try {
      // Repetição (o último só ganhou contagem) ou limpeza: regrava; senão, só acrescenta a linha.
      const grew = this.entries.length === before + 1 && this.entries[before - 1] === last
      if (grew) {
        mkdirSync(dirname(this.file), { recursive: true })
        appendFileSync(this.file, `${JSON.stringify(this.entries[this.entries.length - 1])}\n`)
      } else this.rewrite()
    } catch {
      // sem disco para o registro: fica só na memória
    }
  }

  error(source: LogSource, error: unknown): void {
    const e = error instanceof Error ? error : new Error(String(error))
    this.add('error', source, e.message || e.name, e.stack?.split('\n').slice(1, 9).join('\n'))
  }

  private rewrite(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, this.entries.map((e) => `${JSON.stringify(e)}\n`).join(''))
  }
}

export interface DiagnosticsContext {
  db: Database
  log: ErrorLog
  dbPath: string
  userData: string
  app: { version: string; isPackaged: boolean; execPath: string; locale: string }
}

/** Como o app foi instalado (cada jeito se atualiza de um modo). */
export function installKind(platform: string, env: NodeJS.ProcessEnv, isPackaged: boolean, execPath: string): string {
  if (!isPackaged) return 'desenvolvimento (código-fonte)'
  if (env.APPIMAGE) return 'AppImage'
  if (env.PORTABLE_EXECUTABLE_FILE) return 'Windows portátil'
  if (platform === 'win32') return 'instalador do Windows'
  if (platform === 'linux' && execPath.startsWith('/opt/')) return '.deb'
  return 'outra'
}

const count = (db: Database, table: string) => {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  } catch {
    return 0
  }
}

const SYSTEM_NAME: Record<string, string> = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }
const TRANSCRIPTION: Record<string, string> = { none: 'desligada', builtin: 'embutida', groq: 'Groq', local: 'servidor local' }

/** O diagnóstico já limpo: é exatamente o que a pessoa vê, copia ou salva. */
export function diagnosticsText(ctx: DiagnosticsContext): string {
  const { db } = ctx
  const settings = getSettings(db)
  const folder = readFolderStatus(db)
  const roots = (db.prepare('SELECT root_path AS p FROM courses ORDER BY id').all() as { p: string }[]).map((r) => r.p)
  const clean = (text: string) =>
    sanitize(text, { home: homedir(), userData: ctx.userData, courseRoots: roots, windows: process.platform === 'win32' })
  const ai = settings.aiProvider === 'none' ? 'desligada' : `${AI_PROVIDERS[settings.aiProvider].label} · ${settings.aiModels[settings.aiProvider]}`
  const transcription =
    settings.transcriptionProvider === 'builtin'
      ? `embutida · ${settings.builtinWhisperModel}`
      : (TRANSCRIPTION[settings.transcriptionProvider] ?? settings.transcriptionProvider)
  const text = buildReport({
    app: { version: ctx.app.version, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    system: {
      platform: SYSTEM_NAME[process.platform] ?? process.platform,
      release: release(),
      arch: process.arch,
      session: process.platform === 'linux' ? (process.env.XDG_SESSION_TYPE ?? null) : null,
      locale: ctx.app.locale
    },
    install: installKind(process.platform, process.env, ctx.app.isPackaged, ctx.app.execPath),
    database: {
      schema: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      sizeBytes: existsSync(ctx.dbPath) ? statSync(ctx.dbPath).size : 0,
      counts: [
        plural(count(db, 'courses'), 'curso'),
        plural(count(db, 'lessons'), 'aula'),
        plural(count(db, 'transcripts'), 'transcrição', 'transcrições'),
        plural(count(db, 'notes'), 'anotação', 'anotações'),
        plural(count(db, 'cards'), 'carta'),
        plural(count(db, 'questions'), 'questão', 'questões'),
        plural(count(db, 'notebooks'), 'caderno')
      ]
    },
    settings: {
      IA: clean(ai),
      Transcrição: transcription,
      'Backup automático': settings.autoBackup ? 'ligado' : 'desligado',
      'Pasta de backup': folder.path ? (folder.error ? `com erro: ${clean(folder.error)}` : 'ligada') : 'desligada',
      'Atualização automática': settings.autoUpdateCheck ? 'ligada' : 'desligada'
    },
    log: ctx.log.list().map((e) => ({ ...e, message: clean(e.message), ...(e.detail ? { detail: clean(e.detail) } : {}) })),
    now: Math.floor(Date.now() / 1000)
  })
  return text
}

/** Formulário de problema no GitHub com a versão preenchida (só a versão vai na URL; o diagnóstico a pessoa cola). */
export const issueUrl = (version: string) =>
  `https://github.com/gabrielwaltrich/Tramotak/issues/new?template=problema.yml&versao=${encodeURIComponent(version)}`

export const logFile = (userData: string) => join(userData, 'logs', 'erros.jsonl')
