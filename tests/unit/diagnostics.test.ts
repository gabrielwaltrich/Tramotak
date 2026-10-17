import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendEntry, buildReport, LOG_MAX_AGE_SEC, LOG_MAX_ENTRIES, sanitize, type LogEntry } from '../../src/shared/diagnostics'
import { ErrorLog, installKind } from '../../src/main/diagnostics'

const linux = { home: '/home/gabriel', userData: '/home/gabriel/.config/Tramotak', courseRoots: ['/home/gabriel/Cursos/DevOps PRO 2', '/media/hd/Cálculo'], windows: false }

describe('limpeza dos dados pessoais', () => {
  it('troca pastas de curso, dados do app e pasta pessoal, do mais específico ao mais geral', () => {
    const text = [
      'ENOENT: /home/gabriel/Cursos/DevOps PRO 2/05 - Docker/aula.mp4',
      'falhou em /media/hd/Cálculo/m1/a.pdf',
      'banco em /home/gabriel/.config/Tramotak/tramotak.db',
      'leu /home/gabriel/Downloads/x.srt e /home/outra/y',
      'url file:///home/gabriel/Cursos/DevOps%20PRO%202/a.mp4'
    ].join('\n')
    expect(sanitize(text, linux)).toBe(
      [
        'ENOENT: <curso 1>/05 - Docker/aula.mp4',
        'falhou em <curso 2>/m1/a.pdf',
        'banco em <dados do app>/tramotak.db',
        'leu <pasta pessoal>/Downloads/x.srt e /home/<usuário>/y',
        'url file://<curso 1>/a.mp4'
      ].join('\n')
    )
  })

  it('no Windows, ignora maiúsculas e o tipo de barra', () => {
    const ctx = { home: 'C:\\Users\\Gabriel', userData: 'C:\\Users\\Gabriel\\AppData\\Roaming\\Tramotak', courseRoots: ['D:\\Cursos\\Inglês'], windows: true }
    expect(sanitize('d:/cursos/inglês/01.mp4 e C:\\USERS\\gabriel\\Desktop e C:\\Users\\Maria\\x', ctx)).toBe('<curso 1>/01.mp4 e <pasta pessoal>\\Desktop e C:\\Users\\<usuário>\\x')
  })

  it('tira chaves, tokens, e-mails e IPs (localhost fica)', () => {
    const text = 'sk-or-v1-abcdef1234567890 AIzaSyD1234567890abcdef gsk_ABCDEFGH12345678 Bearer eyJhbGciOi pessoa@exemplo.com.br http://192.168.0.10:11434 http://127.0.0.1:11434'
    expect(sanitize(text, linux)).toBe('sk-or-<chave> AIza<chave> gsk_<chave> Bearer <chave> <e-mail> http://<ip>:11434 http://127.0.0.1:11434')
  })
})

describe('registro de erros', () => {
  const entry = (at: number, message = 'falhou'): LogEntry => ({ at, level: 'error', source: 'principal', message })

  it('conta repetições seguidas em menos de 1 min e corta por quantidade e idade', () => {
    let log: LogEntry[] = []
    log = appendEntry(log, entry(100))
    log = appendEntry(log, entry(130))
    log = appendEntry(log, entry(200))
    expect(log).toEqual([{ ...entry(130), count: 2 }, entry(200)])
    let many: LogEntry[] = []
    for (let i = 0; i < LOG_MAX_ENTRIES + 20; i++) many = appendEntry(many, entry(1000 + i * 100, `e${i}`))
    expect(many).toHaveLength(LOG_MAX_ENTRIES)
    expect(many[0].message).toBe('e20')
    expect(appendEntry([entry(0, 'velho')], entry(LOG_MAX_AGE_SEC + 10, 'novo')).map((e) => e.message)).toEqual(['novo'])
  })

  describe('arquivo', () => {
    let dir: string
    beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'tramotak-log-'))))
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('grava uma linha por erro, sobrevive a reabrir, ignora linhas estragadas e "Cancelado"', () => {
      const file = join(dir, 'logs', 'erros.jsonl')
      let now = 1000
      const log = new ErrorLog(file, () => now)
      log.error('principal', new Error('disco cheio'))
      now = 2000
      log.add('warn', 'ipc', 'ai:generate: limite de uso')
      log.add('warn', 'ipc', 'Cancelado')
      now = 2010
      log.add('warn', 'ipc', 'ai:generate: limite de uso')
      writeFileSync(file, readFileSync(file, 'utf8') + 'isto não é json\n')
      const again = new ErrorLog(file, () => 3000)
      expect(again.list().map((e) => [e.message, e.count ?? 1])).toEqual([
        ['disco cheio', 1],
        ['ai:generate: limite de uso', 2]
      ])
      expect(again.list()[0].detail).toContain('diagnostics.test.ts')
    })
  })
})

describe('texto do diagnóstico', () => {
  it('traz versão, sistema, banco, opções e os erros mais recentes', () => {
    const text = buildReport({
      app: { version: '0.7.2', electron: '44.0.0', chrome: '140.0.1', node: '22.20.0' },
      system: { platform: 'Linux', release: '7.0.0', arch: 'x64', session: 'x11', locale: 'pt-BR' },
      install: '.deb',
      database: { schema: 15, sizeBytes: 1_500_000, counts: ['2 cursos', '30 aulas'] },
      settings: { IA: 'desligada' },
      log: [{ at: 1_800_000_000, level: 'warn', source: 'ipc', message: 'courses:import: Pasta não encontrada', count: 3 }],
      now: 1_800_000_100
    })
    expect(text).toContain('- Versão: 0.7.2 (Electron 44.0.0, Chromium 140.0.1, Node 22.20.0)')
    expect(text).toContain('- Sistema: Linux 7.0.0 x64 · sessão x11 · idioma pt-BR')
    expect(text).toContain('- Banco: versão 15, 1,4 MB · 2 cursos, 30 aulas')
    expect(text).toMatch(/\[aviso · pedido\] courses:import: Pasta não encontrada \(3×\)/)
    expect(buildReport({ ...JSON.parse('{}'), app: { version: '', electron: '', chrome: '', node: '' }, system: { platform: '', release: '', arch: '', session: null, locale: '' }, install: '', database: { schema: 0, sizeBytes: 0, counts: [] }, settings: {}, log: [], now: 0 })).toContain(
      'Nenhum erro registrado'
    )
  })

  it('reconhece o jeito de instalar', () => {
    expect(installKind('linux', {}, false, '/x')).toMatch(/desenvolvimento/)
    expect(installKind('linux', { APPIMAGE: '/tmp/T.AppImage' }, true, '/tmp/.mount/tramotak')).toBe('AppImage')
    expect(installKind('linux', {}, true, '/opt/Tramotak/tramotak')).toBe('.deb')
    expect(installKind('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\T.exe' }, true, 'C:\\x')).toBe('Windows portátil')
    expect(installKind('win32', {}, true, 'C:\\Program Files\\Tramotak\\Tramotak.exe')).toBe('instalador do Windows')
  })
})
