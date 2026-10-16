import { useSyncExternalStore } from 'react'
import { CLOSED_PIP, type PipAppEvent, type PipStatus } from '@shared/pip'

/**
 * Situação da janela flutuante, compartilhada pela tela toda. Uma única assinatura dos eventos do processo
 * principal; os componentes leem com `usePipStatus` e ouvem o resto com `onPipEvent`.
 */
let status: PipStatus = CLOSED_PIP
const statusListeners = new Set<() => void>()
const eventListeners = new Set<(event: PipAppEvent) => void>()
let started = false

function start(): void {
  if (started) return
  started = true
  window.api.pip.onEvent((event) => {
    if (event.type === 'status') {
      status = event.status
      for (const listener of statusListeners) listener()
    }
    for (const listener of eventListeners) listener(event)
  })
  void window.api.pip
    .status()
    .then((s) => {
      status = s
      for (const listener of statusListeners) listener()
    })
    .catch(() => {})
}

function subscribe(listener: () => void): () => void {
  start()
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function usePipStatus(): PipStatus {
  return useSyncExternalStore(subscribe, () => status)
}

export function pipStatus(): PipStatus {
  return status
}

export function onPipEvent(listener: (event: PipAppEvent) => void): () => void {
  start()
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

type ReturnEvent = Extract<PipAppEvent, { type: 'return' }>

/** O player aberto na aula certa assume o "voltar ao app"; senão o app abre a aula no horário. */
let returnTarget: ((event: ReturnEvent) => boolean) | null = null

export function setPipReturnTarget(target: ((event: ReturnEvent) => boolean) | null): void {
  returnTarget = target
}

export function deliverPipReturn(event: ReturnEvent): boolean {
  return returnTarget?.(event) ?? false
}
