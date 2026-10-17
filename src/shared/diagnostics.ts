/**
 * "Relatar problema": registro de erros e o texto de diagnóstico que a pessoa revisa antes de mandar. Nada aqui sai
 * do computador sozinho; e o que a pessoa copia não leva caminhos pessoais, títulos, anotações nem chaves.
 */

export type LogLevel = 'error' | 'warn'
/** De onde veio: processo principal, interface, um pedido da interface ao principal (IPC) ou um processo filho. */
export type LogSource = 'principal' | 'interface' | 'ipc' | 'processo'

export interface LogEntry {
  at: number
  level: LogLevel
  source: LogSource
  message: string
  /** Pilha ou detalhe curto. */
  detail?: string
  /** Repetições seguidas do mesmo erro (contadas em vez de gravadas de novo). */
  count?: number
}

export const LOG_MAX_ENTRIES = 500
export const LOG_MAX_AGE_SEC = 14 * 86_400
const LOG_REPEAT_SEC = 60
const MAX_MESSAGE = 1000
const MAX_DETAIL = 3000

/** Erros esperados de quem interrompe uma ação: não são problema. */
export const isNoise = (message: string): boolean => /^(Cancelado|AbortError)\b/.test(message)

/** Junta uma entrada nova ao registro: repetida em menos de 1 min só conta; mais de 500 ou de 14 dias saem. */
export function appendEntry(entries: LogEntry[], entry: LogEntry, nowSec = entry.at): LogEntry[] {
  const clean: LogEntry = {
    ...entry,
    message: entry.message.slice(0, MAX_MESSAGE),
    ...(entry.detail ? { detail: entry.detail.slice(0, MAX_DETAIL) } : {})
  }
  const last = entries[entries.length - 1]
  let out: LogEntry[]
  if (last && last.message === clean.message && last.source === clean.source && clean.at - last.at < LOG_REPEAT_SEC) {
    out = [...entries.slice(0, -1), { ...last, at: clean.at, count: (last.count ?? 1) + 1 }]
  } else out = [...entries, clean]
  return pruneEntries(out, nowSec)
}

export function pruneEntries(entries: LogEntry[], nowSec: number): LogEntry[] {
  return entries.filter((e) => nowSec - e.at <= LOG_MAX_AGE_SEC).slice(-LOG_MAX_ENTRIES)
}

/** Lê uma linha do arquivo de registro (JSON por linha); linhas estragadas são ignoradas. */
export function parseEntry(line: string): LogEntry | null {
  try {
    const e = JSON.parse(line) as Partial<LogEntry>
    if (typeof e.at !== 'number' || typeof e.message !== 'string') return null
    if (e.level !== 'error' && e.level !== 'warn') return null
    if (!['principal', 'interface', 'ipc', 'processo'].includes(e.source as string)) return null
    return {
      at: e.at,
      level: e.level,
      source: e.source as LogSource,
      message: e.message,
      ...(typeof e.detail === 'string' ? { detail: e.detail } : {}),
      ...(typeof e.count === 'number' && e.count > 1 ? { count: e.count } : {})
    }
  } catch {
    return null
  }
}

// ── Limpeza ─────────────────────────────────────────────────────────────────

export interface SanitizeContext {
  home: string
  userData: string
  /** Pastas dos cursos (viram "<curso 1>", "<curso 2>"… na ordem dada). */
  courseRoots: string[]
  /** Windows: caminhos sem diferença de maiúsculas e com as duas barras. */
  windows: boolean
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Expressão que acha um caminho escrito com / ou \ (e, no Windows, sem ligar para maiúsculas). */
function pathPattern(path: string, windows: boolean): RegExp | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed.length < 3) return null
  // A barra do começo casa com uma só (em "file:///home/…" as outras são do esquema e ficam).
  const rooted = /^[\\/]/.test(trimmed)
  const body = trimmed
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('[\\\\/]+')
  return new RegExp(`${rooted ? '[\\\\/]' : ''}${body}`, windows ? 'gi' : 'g')
}

/**
 * Tira do texto o que identifica a pessoa: pastas dos cursos, a pasta de dados, a pasta pessoal (com o nome de
 * usuário), chaves e tokens, e-mails e endereços de rede. Caminhos aparecem também codificados em URLs
 * (`file:///home/…`, `%2F`), por isso o texto é limpo duas vezes: como veio e decodificado.
 */
export function sanitize(text: string, ctx: SanitizeContext): string {
  let out = text
  try {
    if (/%[0-9a-f]{2}/i.test(out)) out = decodeURIComponent(out)
  } catch {
    // texto com % solto: segue como está
  }
  // Do mais específico para o mais geral: o curso dentro da pasta pessoal vira "<curso N>", não "<pasta pessoal>/…".
  const roots = ctx.courseRoots.map((path, i) => ({ path, label: `<curso ${i + 1}>` })).sort((a, b) => b.path.length - a.path.length)
  for (const { path, label } of [...roots, { path: ctx.userData, label: '<dados do app>' }, { path: ctx.home, label: '<pasta pessoal>' }]) {
    const pattern = pathPattern(path, ctx.windows)
    if (pattern) out = out.replace(pattern, label)
  }
  return (
    out
      // Usuário em caminhos que sobraram (outra pasta pessoal, perfil temporário).
      .replace(/([\\/](?:home|Users)[\\/])[^\\/\s'"]+/gi, '$1<usuário>')
      .replace(/(C:[\\/]+Users[\\/]+)[^\\/\s'"]+/gi, '$1<usuário>')
      // Chaves e tokens: OpenAI/OpenRouter/Anthropic, Google, Groq, cabeçalhos de autorização.
      .replace(/\b(sk-(?:ant-|or-)?|AIza|gsk_)[A-Za-z0-9_-]{8,}/g, '$1<chave>')
      .replace(/\b(Bearer|x-api-key:?|x-goog-api-key:?)\s+\S+/gi, '$1 <chave>')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<e-mail>')
      // Endereços de rede (o host de um servidor local de IA, por exemplo); localhost fica.
      .replace(/\b(?!127\.0\.0\.1\b)(\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
  )
}

// ── Relatório ───────────────────────────────────────────────────────────────

export interface DiagnosticsInput {
  app: { version: string; electron: string; chrome: string; node: string }
  system: { platform: string; release: string; arch: string; session: string | null; locale: string }
  install: string
  /** `counts`: contagens já escritas ("1 curso", "30 aulas"). */
  database: { schema: number; sizeBytes: number; counts: string[] }
  settings: Record<string, string>
  log: LogEntry[]
  /** Quando o relatório foi gerado (segundos). */
  now: number
}

const SOURCE_LABEL: Record<LogSource, string> = { principal: 'principal', interface: 'interface', ipc: 'pedido', processo: 'processo' }

const isoLocal = (sec: number) => {
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Quantos erros vão no texto (os mais recentes); o arquivo guarda até 500. */
export const REPORT_MAX_ENTRIES = 60

/** Texto em Markdown para colar no formulário de problema (já limpo: chame `sanitize` antes de mostrar). */
export function buildReport(input: DiagnosticsInput): string {
  const { app, system, database } = input
  const mb = (database.sizeBytes / 1024 / 1024).toFixed(1).replace('.', ',')
  const lines = [
    '## Diagnóstico do Tramotak',
    '',
    `- Gerado em: ${isoLocal(input.now)}`,
    `- Versão: ${app.version} (Electron ${app.electron}, Chromium ${app.chrome}, Node ${app.node})`,
    `- Sistema: ${system.platform} ${system.release} ${system.arch}${system.session ? ` · sessão ${system.session}` : ''} · idioma ${system.locale}`,
    `- Instalação: ${input.install}`,
    `- Banco: versão ${database.schema}, ${mb} MB · ${database.counts.join(', ')}`,
    ...Object.entries(input.settings).map(([k, v]) => `- ${k}: ${v}`),
    ''
  ]
  const recent = input.log.slice(-REPORT_MAX_ENTRIES)
  if (!recent.length) {
    lines.push('### Erros recentes', '', 'Nenhum erro registrado nos últimos 14 dias.')
  } else {
    const omitted = input.log.length - recent.length
    lines.push(`### Erros recentes (${input.log.length}${omitted > 0 ? `, mostrando os ${recent.length} últimos` : ''})`, '', '```')
    for (const e of recent) {
      const times = e.count && e.count > 1 ? ` (${e.count}×)` : ''
      lines.push(`${isoLocal(e.at)} [${e.level === 'error' ? 'erro' : 'aviso'} · ${SOURCE_LABEL[e.source]}] ${e.message}${times}`)
      if (e.detail) lines.push(...e.detail.split('\n').slice(0, 8).map((l) => `    ${l}`))
    }
    lines.push('```')
  }
  return lines.join('\n')
}
