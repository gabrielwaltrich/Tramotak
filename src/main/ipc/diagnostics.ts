import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { stamp } from '../backup/backup'
import { diagnosticsText, issueUrl, type DiagnosticsContext } from '../diagnostics'

/** "Relatar problema": a interface só pede o texto e as ações; caminho do arquivo e URL ficam aqui. */
export function registerDiagnosticsIpc(ctx: DiagnosticsContext): void {
  ipcMain.handle(IPC.diagnosticsGet, () => diagnosticsText(ctx))
  ipcMain.handle(IPC.diagnosticsCopy, () => clipboard.writeText(diagnosticsText(ctx)))
  ipcMain.handle(IPC.diagnosticsSave, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Salvar diagnóstico do Tramotak',
      defaultPath: `Tramotak-diagnostico-${stamp()}.txt`,
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, diagnosticsText(ctx))
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
