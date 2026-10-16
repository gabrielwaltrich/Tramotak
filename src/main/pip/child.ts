import { app, protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/media'
import { serveFile } from '../protocol/media'
import { createPipWindow, type PipWindowHandle } from './window'
import { mediaKey, type FromPipProcess, type PipMediaMap, type ToPipProcess } from './messages'

/**
 * Processo separado que só mostra a janela flutuante. Existe porque no Wayland do GNOME nenhuma janela consegue
 * ficar por cima das outras sozinha: o app continua em Wayland e só este processo roda em X11 (XWayland).
 *
 * Não abre o banco: recebe do app quais arquivos pode tocar e devolve o que acontece na janela. A janela não tem
 * campo de texto, então o X11 não expõe nada além da imagem do vídeo.
 */
export function runPipChild(): void {
  const send = (message: FromPipProcess) => process.send?.(message)
  let files: PipMediaMap = {}
  let handle: PipWindowHandle | null = null

  // O app fechou (ou travou): este processo não tem motivo para continuar.
  process.on('disconnect', () => app.quit())
  app.on('window-all-closed', () => app.quit())

  app.whenReady().then(() => {
    // Só serve os arquivos da aula aberta, liberados pelo app.
    protocol.handle(MEDIA_SCHEME, async (request) => {
      const key = mediaKey(request.url)
      const media = key ? files[key] : undefined
      if (!media) return new Response('Não liberado', { status: 404 })
      if ('body' in media) return new Response(media.body, { headers: { 'Content-Type': media.type, 'Access-Control-Allow-Origin': '*' } })
      return serveFile(media.path, request.headers.get('range'))
    })

    process.on('message', (raw) => {
      const message = raw as ToPipProcess
      switch (message?.kind) {
        case 'open':
          if (handle) return
          handle = createPipWindow({
            settings: message.settings,
            savedBounds: message.savedBounds,
            onEvent: (event) => send({ kind: 'event', event }),
            onBounds: (rect) => send({ kind: 'bounds', rect }),
            onClosed: () => {
              handle = null
              send({ kind: 'closed' })
              app.quit()
            }
          })
          break
        case 'media':
          files = message.files
          break
        case 'command':
          handle?.send(message.command)
          break
        case 'close':
          if (handle) handle.close()
          else app.quit()
          break
      }
    })
    send({ kind: 'hello' })
  })
}
