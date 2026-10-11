import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OPENROUTER_URL } from './client'

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
const LOGIN_TIMEOUT_MS = 5 * 60_000

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

const PAGE = (title: string, text: string) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Tramotak</title>
<body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#aaa">${text}</p></div></body></html>`

/** Abre o servidor de retorno só no endereço local, numa porta livre. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

/**
 * Login do OpenRouter (OAuth com PKCE): abre o navegador, recebe o código no endereço local e troca por
 * uma chave da própria conta da pessoa. Devolve a chave.
 */
export async function loginOpenRouter(
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(16))
  let settle: { resolve: (r: { code: string; res: ServerResponse }) => void; reject: (e: Error) => void }
  const codePromise = new Promise<{ code: string; res: ServerResponse }>((resolve, reject) => (settle = { resolve, reject }))
  codePromise.catch(() => undefined) // a rejeição é tratada no await abaixo

  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.get('state') !== state) {
      res.end(PAGE('Não foi possível entrar', 'Volte ao Tramotak e tente de novo.'))
      return settle.reject(new Error('O OpenRouter não devolveu uma autorização válida'))
    }
    // A página só responde depois da troca pela chave, para não dizer "conectado" antes da hora.
    settle.resolve({ code, res })
  }
  const server = createServer(handler)
  // "localhost" pode resolver para IPv6 no navegador; escuta também em ::1 (se houver) na mesma porta.
  const server6 = createServer(handler)

  const timer = setTimeout(() => settle.reject(new Error('O login demorou demais. Tente de novo.')), LOGIN_TIMEOUT_MS)
  const onAbort = () => settle.reject(new Error('Cancelado'))
  signal.addEventListener('abort', onAbort)
  try {
    const port = await listen(server)
    server6.on('error', () => undefined)
    server6.listen(port, '::1')
    const params = new URLSearchParams({
      callback_url: `http://localhost:${port}/callback`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      key_label: 'Tramotak'
    })
    await openBrowser(`${OPENROUTER_AUTH_URL}?${params}`)
    const { code, res } = await codePromise
    try {
      const response = await fetchImpl(`${OPENROUTER_URL}/auth/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        signal
      })
      const body = (await response.json().catch(() => ({}))) as { key?: string; error?: { message?: string } }
      if (!response.ok || !body.key) throw new Error(`O OpenRouter recusou o login${body.error?.message ? `: ${body.error.message}` : ''}`)
      res.end(PAGE('Pronto! Conta do OpenRouter conectada.', 'Pode fechar esta aba e voltar ao Tramotak.'))
      return body.key
    } catch (error) {
      res.end(PAGE('Não foi possível entrar', `${error instanceof Error ? error.message : 'Erro desconhecido'}. Volte ao Tramotak e tente de novo.`.replace(/[<>&]/g, '')))
      throw error
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    server.close()
    server6.close()
  }
}
