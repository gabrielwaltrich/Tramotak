import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const FIXTURE = join(__dirname, 'fixtures', 'Curso E2E')

let workdir: string
let coursePath: string
let userData: string

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const args = ['.', `--user-data-dir=${userData}`]
  // Runners Linux de CI não têm o helper SUID do sandbox do Chromium.
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')
  const app = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'production' } })
  // O seletor de pasta é nativo: no teste ele devolve direto a pasta do curso.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, coursePath)
  const page = await app.firstWindow()
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible()
  return { app, page }
}

test.beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'tramotak-e2e-'))
  coursePath = join(workdir, 'Curso E2E')
  userData = join(workdir, 'profile')
  await cp(FIXTURE, coursePath, { recursive: true })
})

test.afterAll(async () => {
  await rm(workdir, { recursive: true, force: true })
})

test('importar → assistir → anotar → concluir, e os dados sobrevivem a um reinício', async () => {
  const { app, page } = await launch()

  // Importar
  await page.getByRole('link', { name: 'Meus Cursos' }).click()
  await page.getByRole('button', { name: 'Importar seu primeiro curso' }).click()
  await page.getByRole('button', { name: 'Escolher pasta' }).click()
  await expect(page.getByText(/1 módulo · 3 aulas · 1 legenda/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Importar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Curso E2E' })).toBeVisible()

  // Assistir: o vídeo precisa avançar de verdade (protocolo + codec H.264)
  await page.getByRole('link', { name: /Boas-vindas/ }).click()
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(1)
  expect(await video.evaluate((v: HTMLVideoElement) => v.textTracks.length)).toBe(1)

  // Anotar com N
  await video.evaluate((v: HTMLVideoElement) => v.pause())
  await page.keyboard.press('n')
  const composer = page.getByRole('textbox', { name: 'Nova anotação' })
  await expect(composer).toBeFocused()
  await composer.fill('Minha primeira anotação')
  await composer.press('Control+Enter')
  await expect(page.getByRole('tabpanel').getByText('Minha primeira anotação')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Anotações (1)' })).toBeVisible()

  // Concluir
  await page.getByRole('button', { name: 'Concluir' }).click()
  await expect(page.getByRole('button', { name: 'Concluída' })).toBeVisible()

  // Início sugere a próxima aula
  await page.getByRole('link', { name: 'Início' }).click()
  await expect(page.getByText('Próxima aula')).toBeVisible()
  await expect(page.getByText(/Primeiro módulo · Segunda aula/)).toBeVisible()

  await app.close()

  // Reinício: curso, conclusão e anotação continuam lá
  const second = await launch()
  await second.page.getByRole('link', { name: 'Meus Cursos' }).click()
  // 1 de 3 aulas concluída; a duração já foi lida dos vídeos ("12 s").
  await expect(second.page.getByText(/12 s · 33%/)).toBeVisible()
  await second.page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
  await second.page.getByRole('link', { name: /Boas-vindas/ }).click()
  await expect(second.page.getByRole('tabpanel').getByText('Minha primeira anotação')).toBeVisible()
  await second.app.close()
})

test('aula em Markdown abre isolada, sem scripts', async () => {
  const { app, page } = await launch()
  await page.getByRole('link', { name: 'Meus Cursos' }).click()
  await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
  await page.getByRole('link', { name: /Leia-me/ }).click()
  const frame = page.locator('iframe[title="Conteúdo da aula"]')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame.contentFrame().getByRole('heading', { name: 'Leia antes' })).toBeVisible()
  await app.close()
})

test('busca global: Ctrl+K encontra a anotação e abre o vídeo no horário dela', async () => {
  const { app, page } = await launch()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const input = page.getByRole('combobox', { name: 'Buscar' })
  await expect(input).toBeFocused()

  // Sem acento e só o começo da palavra
  await input.fill('primeira anot')
  const note = page.getByRole('group', { name: 'Anotações' }).getByRole('option')
  await expect(note).toHaveCount(1)
  await expect(note).toContainText('Boas-vindas')

  await input.fill('boas')
  await expect(page.getByRole('group', { name: 'Aulas' }).getByRole('option')).toContainText('Boas-vindas')

  await input.fill('primeira anotacao')
  await expect(note).toHaveCount(1)
  await input.press('Enter')

  await expect(page).toHaveURL(/#\/lesson\/\d+\?t=\d+$/)
  const t = Number(new URL(page.url().replace('#/', '')).searchParams.get('t'))
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(t)
  await app.close()
})
