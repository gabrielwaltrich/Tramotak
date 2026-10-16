import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { PipCommand, PipSettings, Rect } from '@shared/pip'
import { createPipWindow } from './window'
import { PIP_CHILD_FLAG, type FromPipProcess, type PipMediaMap, type ToPipProcess } from './messages'

/** Caminho entre o app e a janela flutuante: na mesma janela do processo ou num processo separado. */
export interface PipTransport {
  send(command: PipCommand): void
  /** Arquivos que a janela pode tocar (só importa no processo separado, que não tem o banco). */
  allowMedia(files: PipMediaMap): void
  close(): void
  /** A janela consegue ficar por cima das outras sozinha. */
  readonly onTop: boolean
  /** A janela consegue se posicionar sozinha (no Wayland, só o sistema move janelas). */
  readonly canMove: boolean
}

export interface TransportOptions {
  settings: PipSettings
  savedBounds: unknown
}

export interface TransportHandlers {
  onEvent(raw: unknown): void
  onBounds(rect: Rect): void
  /** `failed`: o processo separado não chegou a abrir (ex.: sem XWayland). */
  onClosed(failed: boolean): void
}

export function windowTransport(options: TransportOptions, handlers: TransportHandlers, onTop: boolean): PipTransport {
  const handle = createPipWindow({ ...options, onEvent: handlers.onEvent, onBounds: handlers.onBounds, onClosed: () => handlers.onClosed(false) })
  return {
    send: (command) => handle.send(command),
    allowMedia: () => undefined,
    close: () => handle.close(),
    onTop,
    canMove: onTop
  }
}

export function processTransport(options: TransportOptions, handlers: TransportHandlers): PipTransport {
  const args = [
    // Em desenvolvimento o executável é o Electron e precisa da pasta do app; instalado, o app já vem embutido.
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    '--ozone-platform=x11',
    PIP_CHILD_FLAG,
    // Perfil próprio: dois processos do Chromium não podem dividir a mesma pasta de dados.
    `--user-data-dir=${join(app.getPath('userData'), 'pip')}`,
    ...(app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : []),
    // Gancho de teste: deixa um script dirigir a janela do processo separado.
    ...(process.env.TRAMOTAK_PIP_DEBUG_PORT ? [`--remote-debugging-port=${Number(process.env.TRAMOTAK_PIP_DEBUG_PORT)}`] : [])
  ]
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'ignore', is.dev ? 'inherit' : 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  })
  let started = false
  let closed = false
  // Até o processo dizer "olá", as mensagens esperam aqui (as enviadas antes se perderiam).
  const queue: ToPipProcess[] = [{ kind: 'open', settings: options.settings, savedBounds: options.savedBounds }]
  const post = (message: ToPipProcess) => {
    if (!started) queue.push(message)
    else if (child.connected) child.send(message)
  }

  child.on('message', (raw) => {
    const message = raw as FromPipProcess
    switch (message?.kind) {
      case 'hello':
        started = true
        for (const m of queue.splice(0)) child.send(m)
        break
      case 'event':
        handlers.onEvent(message.event)
        break
      case 'bounds':
        handlers.onBounds(message.rect)
        break
    }
  })
  const finish = () => {
    if (closed) return
    closed = true
    handlers.onClosed(!started)
  }
  child.on('exit', finish)
  child.on('error', finish)

  return {
    send: (command) => post({ kind: 'command', command }),
    allowMedia: (files) => post({ kind: 'media', files }),
    close: () => {
      if (child.connected && started) child.send({ kind: 'close' })
      else child.kill()
      // Se o processo não sair por conta própria, encerra.
      setTimeout(() => child.exitCode === null && child.kill(), 3000).unref()
    },
    onTop: true,
    canMove: true
  }
}
