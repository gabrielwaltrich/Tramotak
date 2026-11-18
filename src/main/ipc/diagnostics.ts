import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { stamp } from '../backup/backup'
import { diagnosticsText, issueUrl, type DiagnosticsContext } from '../diagnostics'

/** "Relatar problema": a interface só pede o texto e as ações; caminho do arquivo e URL ficam aqui. */
export function registerDiagnosticsIpc(ctx: DiagnosticsContext): void {
  // Copiar e salvar usam o texto que a pessoa viu na prévia (gerar de novo mudaria o horário e os erros).
  const shown = (text: unknown): string => {
    if (typeof text !== 'string' || !text.startsWith('## Diagnóstico do Tramotak') || text.length > 200_000) throw new Error('Diagnóstico inválido')
    return text
  }
  ipcMain.handle(IPC.diagnosticsGet, () => diagnosticsText(ctx))
  ipcMain.handle(IPC.diagnosticsCopy, (_e, text: unknown) => clipboard.writeText(shown(text)))
  ipcMain.handle(IPC.diagnosticsSave, async (event, text: unknown) => {
    const content = shown(text)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Salvar diagnóstico do Tramotak',
      defaultPath: `Tramotak-diagnostico-${stamp()}.txt`,
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content)
    return result.filePath
  })
  ipcMain.handle(IPC.diagnosticsOpenIssue, () => shell.openExternal(issueUrl(app.getVersion())))
  // Erros da interface (window.onerror, promessas sem tratamento) entram no mesmo registro.
  ipcMain.handle(IPC.diagnosticsLogError, (_e, input: unknown) => {
    const r = (input && typeof input === 'object' ? input : {}) as { message?: unknown; stack?: unknown }
    const message = typeof r.message === 'string' ? r.message.slice(0, 1000) : ''
    const stack = typeof r.stack === 'string' ? r.stack.split('\n').slice(1, 9).join('\n').slice(0, 3000) : undefined
    if (message) ctx.log.add('error', 'interface', message, stack)
  })
}
