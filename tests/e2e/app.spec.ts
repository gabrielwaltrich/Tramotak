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

test('flashcards: anotação vira carta, estudo com teclado e link de volta para a aula', async () => {
  const { app, page } = await launch()
  await page.getByRole('link', { name: 'Meus Cursos' }).click()
  await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
  await page.getByRole('link', { name: /Boas-vindas/ }).click()

  // Criar a carta a partir da anotação do primeiro teste
  await page.getByRole('tabpanel').getByText('Minha primeira anotação').hover()
  await page.getByRole('button', { name: 'Criar flashcard' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Frente (pergunta)')).toHaveValue('Minha primeira anotação')
  await expect(dialog.getByLabel('Baralho')).toContainText('Novo baralho: Curso E2E')
  await dialog.getByLabel('Verso (resposta)').fill('Resposta da carta')
  await dialog.getByRole('button', { name: 'Criar carta' }).click()
  await expect(page.getByText('Carta criada em “Curso E2E”')).toBeVisible()

  // Estudar: Espaço revela, 4 = Fácil
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page.getByText('1 novas')).toBeVisible()
  await page.getByRole('button', { name: 'Estudar' }).click()
  await expect(page.getByText('Minha primeira anotação')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByText('Resposta da carta')).toBeVisible()
  await expect(page.getByRole('button', { name: /Fácil\s*4 dias/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ver na aula: Boas-vindas/ })).toHaveAttribute('href', /#\/lesson\/\d+\?t=\d+/)
  await page.keyboard.press('4')
  await expect(page.getByText('Parabéns! Você terminou este baralho por hoje.')).toBeVisible()

  // A carta passou a ser revisão, para daqui a 4 dias
  await page.getByRole('link', { name: 'Ver baralho' }).click()
  await expect(page.getByText('Revisão')).toBeVisible()
  await expect(page.getByText('em 4 dias')).toBeVisible()
  await app.close()
})

test('planner e progresso: tarefa de hoje aparece no Início e conclui de lá; progresso mostra o estudo', async () => {
  const { app, page } = await launch()
  // Notificações reais do sistema não fazem sentido no CI.
  await page.evaluate(() => window.api.settings.update({ notificationsEnabled: false }))

  await page.getByRole('link', { name: 'Planner' }).click()
  await page.getByRole('button', { name: 'Nova tarefa' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Título').fill('Revisar o primeiro módulo')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await dialog.getByLabel('Agendada para').fill(today)
  await dialog.getByLabel('Duração (min)').fill('25')
  await dialog.getByLabel('Curso').selectOption({ label: 'Curso E2E' })
  await dialog.getByRole('button', { name: 'Criar tarefa' }).click()
  await expect(page.getByRole('region', { name: 'A fazer' }).getByText('Revisar o primeiro módulo')).toBeVisible()

  // Calendário: a tarefa está no dia de hoje
  await page.getByRole('tab', { name: 'Calendário' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${today}, 1 tarefa`) })).toBeVisible()

  // Início: painel Hoje conclui a tarefa
  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('checkbox', { name: 'Concluir Revisar o primeiro módulo' }).check()
  await expect(page.getByText('“Revisar o primeiro módulo” concluída')).toBeVisible()
  await page.getByRole('link', { name: 'Planner' }).click()
  await page.getByRole('tab', { name: 'Quadro' }).click()
  await expect(page.getByRole('region', { name: 'Concluído' }).getByText('Revisar o primeiro módulo')).toBeVisible()

  // Progresso: aula concluída no primeiro teste, sequência e histórico
  await page.getByRole('link', { name: 'Progresso' }).click()
  await expect(page.getByText('Aulas concluídas')).toBeVisible()
  await expect(page.getByRole('img', { name: /Mapa de atividade/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Boas-vindas/ })).toBeVisible()
  await page.getByLabel('Filtrar histórico').fill('nada disso existe')
  await expect(page.getByText('Nenhuma aula encontrada.')).toBeVisible()
  await app.close()
})

test('questões: editor, simulado com correção imediata, envio e resultado', async () => {
  const { app, page } = await launch()
  await page.getByRole('link', { name: 'Questões' }).click()
  await page.getByRole('button', { name: 'Criar banco' }).click()
  await page.getByRole('dialog').getByLabel('Nome').fill('Banco E2E')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar' }).click()
  await expect(page.getByRole('heading', { name: 'Banco E2E' })).toBeVisible()

  // Múltipla escolha com LaTeX
  await page.getByRole('button', { name: 'Nova questão' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Enunciado').fill('Derivada de $x^2$?')
  await expect(dialog.getByText('Prévia:')).toBeVisible()
  await dialog.getByLabel('Texto da alternativa A').fill('$2x$')
  await dialog.getByLabel('Texto da alternativa B').fill('$x$')
  await dialog.getByLabel('Alternativa A correta').check()
  await dialog.getByLabel('Explicação (aparece na correção)').fill('Regra do tombo')
  await dialog.getByRole('button', { name: 'Criar questão' }).click()

  // Verdadeiro ou falso
  await page.getByRole('button', { name: 'Nova questão' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tipo').selectOption('truefalse')
  await dialog.getByLabel('Enunciado').fill('O céu é verde')
  await dialog.getByLabel('Falsa').check()
  await dialog.getByRole('button', { name: 'Criar questão' }).click()
  await expect(page.getByRole('tab', { name: 'Questões (2)' })).toBeVisible()

  // Simulado com correção a cada questão, sem embaralhar
  await page.getByRole('tab', { name: /Simulados/ }).click()
  await page.getByRole('button', { name: 'Novo simulado' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome').fill('Simulado E2E')
  await dialog.getByRole('radio', { name: 'A cada questão' }).click()
  await dialog.getByLabel('Embaralhar a ordem das questões').uncheck()
  await dialog.getByLabel('Embaralhar as alternativas').uncheck()
  await dialog.getByRole('button', { name: 'Criar simulado' }).click()
  await page.getByRole('button', { name: 'Começar' }).click()

  // Questão 1: acerta e vê a explicação na hora
  await expect(page.getByText('Questão 1 de 2')).toBeVisible()
  await page.getByRole('radio', { name: /^A/ }).click()
  await page.getByRole('button', { name: 'Responder' }).click()
  await expect(page.getByText('certa', { exact: true })).toBeVisible()
  await expect(page.getByText('Regra do tombo')).toBeVisible()
  await page.getByRole('button', { name: /Próxima/ }).click()

  // Questão 2: erra
  await page.getByRole('radio', { name: 'Verdadeiro' }).click()
  await page.getByRole('button', { name: 'Responder' }).click()
  await expect(page.getByText('errada', { exact: true })).toBeVisible()

  await page.getByRole('main').getByRole('button', { name: 'Enviar prova' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('50%')).toBeVisible()
  await expect(page.getByText('Reprovado (corte 60%)')).toBeVisible()

  // Desempenho do banco
  await page.getByRole('link', { name: 'Voltar ao banco' }).click()
  await page.getByRole('tab', { name: 'Desempenho' }).click()
  await expect(page.getByText(/1 tentativa · média 50%/)).toBeVisible()
  await app.close()
})

test('cadernos e mapas: Markdown seguro com fórmula, salvamento automático e mapa pelo teclado', async () => {
  const { app, page } = await launch()
  await page.evaluate(() => {
    ;(window as unknown as { __alerted: boolean }).__alerted = false
    window.alert = () => {
      ;(window as unknown as { __alerted: boolean }).__alerted = true
    }
  })

  // Caderno
  await page.getByRole('link', { name: 'Cadernos' }).click()
  await page.getByRole('button', { name: 'Criar caderno' }).click()
  await page.getByRole('dialog').getByLabel('Nome').fill('Caderno E2E')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar' }).click()
  await page.getByRole('button', { name: 'Clique para escrever…' }).click()
  await page.getByLabel('Texto do bloco').fill('# Resumo\n\nFórmula $x^2$ e <img src=x onerror="alert(1)">')
  await page.getByLabel('Título da página').click() // sai da edição do bloco
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  await expect(page.locator('.prose-tk .katex')).toHaveCount(1)
  await expect(page.locator('.prose-tk img[onerror]')).toHaveCount(0)
  await expect(page.getByText('Salvo')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __alerted: boolean }).__alerted)).toBe(false)

  // Busca encontra o conteúdo do caderno
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.getByRole('combobox', { name: 'Buscar' }).fill('resumo')
  await expect(page.getByRole('group', { name: 'Cadernos' }).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Mapa mental
  await page.getByRole('link', { name: 'Mapas Mentais' }).click()
  await page.getByRole('button', { name: 'Criar mapa' }).click()
  await page.getByRole('dialog').getByLabel('Tema central').fill('Biologia')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar' }).click()
  await expect(page.locator('[data-node-id]')).toHaveCount(1)
  await page.getByLabel('Mapa mental').focus()
  await page.keyboard.press('Tab')
  await page.getByLabel('Texto do tópico').fill('Célula')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.getByLabel('Texto do tópico').fill('Genética')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-node-id]')).toHaveCount(3)
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-node-id]')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-node-id]')).toHaveCount(3)
  await expect(page.getByText('Salvo')).toBeVisible()

  // O mapa salvo reaparece na lista
  await page.getByLabel('Voltar para mapas mentais').click()
  await expect(page.getByText('3 tópicos')).toBeVisible()
  await app.close()
})

test('vídeo HEVC: o player detecta, oferece conversão e passa a mostrar a imagem', async () => {
  // Vídeo HEVC gerado na hora com o FFmpeg embutido
  const { execFileSync } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string
  const hevcCourse = join(workdir, 'Curso HEVC')
  mkdirSync(join(hevcCourse, '1. Módulo'), { recursive: true })
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-c:a', 'aac', join(hevcCourse, '1. Módulo', '1. Aula HEVC.mp4')])

  const { app, page } = await launch()
  const lessonId = await page.evaluate(async (path) => {
    const id = await window.api.courses.import({ path, title: 'Curso HEVC', structure: 'auto', numbering: 'dot' })
    return (await window.api.courses.get(id)).modules[0].lessons[0].id
  }, hevcCourse)
  await page.evaluate((id) => (location.hash = `#/lesson/${id}`), lessonId)

  // Sem a verificação, o Chromium tocaria só o áudio com tela preta, sem erro nenhum
  await expect(page.getByText('Vídeo em HEVC, que o player não toca')).toBeVisible()
  await page.getByRole('button', { name: 'Converter para tocar aqui' }).click()
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 60_000 }).toBe(320)
  await expect(page.getByText('Este vídeo não pode ser reproduzido aqui')).toHaveCount(0)
  await app.close()
})

test('IA: provedor local gera flashcards de uma aula, revisão escolhe e salva no baralho', async () => {
  // Servidor falso no formato do Ollama: devolve cartas e guarda o que recebeu
  const { createServer } = await import('node:http')
  const received: { model: string; format: string; user: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-teste' }))
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
    const data = JSON.parse(body)
    received.push({ model: data.model, format: data.format, user: data.messages.at(-1).content })
    const cards = [
      { front: 'O que a legenda diz?', back: 'Olá' },
      { front: 'Carta descartada', back: 'não salvar' }
    ]
    res.end(JSON.stringify({ message: { content: JSON.stringify({ cards }) } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const { app, page } = await launch()
  try {
    await page.getByRole('link', { name: 'Configurações' }).click()
    await page.getByRole('radio', { name: 'Ollama (local)' }).click()
    await page.locator('#ai-url').fill(`http://127.0.0.1:${port}`)
    await page.locator('#ai-url').locator('..').getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Ollama 0.0.0-teste encontrado')).toBeVisible()
    await page.getByRole('button', { name: 'modelo-teste' }).click()
    await expect.poll(() => page.evaluate(() => window.api.settings.get().then((s) => s.aiModels.ollama))).toBe('modelo-teste')

    // Do player para a IA, já com a aula escolhida (legenda + anotação como material)
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
    await page.getByRole('link', { name: /Boas-vindas/ }).click()
    await page.getByRole('link', { name: 'Gerar com IA' }).click()
    await expect(page.getByText(/Legenda · \d+ caracteres/)).toBeVisible()
    await page.getByRole('button', { name: 'Gerar flashcards' }).click()

    await expect(page.getByText('Revisar e salvar · flashcards')).toBeVisible()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ model: 'modelo-teste', format: 'json' })
    expect(received[0].user).toContain('Olá, legenda de teste')
    expect(received[0].user).toContain('Minha primeira anotação')

    await page.getByRole('checkbox', { name: 'Incluir carta 2' }).uncheck()
    await page.locator('#ai-deck').selectOption('new')
    await page.locator('#ai-deck-name').fill('Baralho da IA')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Baralho da IA' })).toBeVisible()
    await expect(page.getByText('O que a legenda diz?')).toBeVisible()
    await expect(page.getByText('Carta descartada')).toHaveCount(0)
  } finally {
    await app.close()
    server.close()
  }
})

test('backup e pacote: salva o banco, exporta baralho com anotações e importa ligado ao curso', async () => {
  const backupFile = join(workdir, 'backup.db')
  const packageFile = join(workdir, 'pacote.tramotak')
  const { app, page } = await launch()
  try {
    const stubDialogs = (save: string | null, open: string | null) =>
      app.evaluate(
        ({ dialog }, paths) => {
          dialog.showSaveDialog = (async () => (paths.save ? { canceled: false, filePath: paths.save } : { canceled: true })) as typeof dialog.showSaveDialog
          dialog.showOpenDialog = (async () => (paths.open ? { canceled: false, filePaths: [paths.open] } : { canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog
        },
        { save, open }
      )

    await page.getByRole('link', { name: 'Configurações' }).click()
    await stubDialogs(backupFile, null)
    await page.getByRole('button', { name: 'Fazer backup agora' }).click()
    await expect(page.getByText(/Backup salvo/)).toBeVisible()

    // O arquivo salvo é reconhecido como backup restaurável
    await stubDialogs(null, backupFile)
    await page.getByRole('button', { name: 'Restaurar de um arquivo…' }).click()
    const restore = page.getByRole('dialog', { name: 'Restaurar backup' })
    await expect(restore.getByText(/\d+ cursos? · \d+ aulas/)).toBeVisible()
    await restore.getByRole('button', { name: 'Cancelar' }).click()

    // Exporta o baralho "Baralho da IA" (cartas ligadas à aula) e as anotações do curso
    await stubDialogs(packageFile, null)
    await page.getByRole('button', { name: 'Exportar pacote…' }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Exportar pacote de estudo' })
    await exportDialog.getByRole('checkbox', { name: /Curso E2E · \d+ anotaç/ }).check()
    await exportDialog.getByRole('checkbox', { name: /Baralho da IA/ }).check()
    await exportDialog.getByRole('button', { name: /Exportar \(2\)/ }).click()
    await expect(page.getByText(/Pacote exportado/)).toBeVisible()

    await stubDialogs(null, packageFile)
    await page.getByRole('button', { name: 'Importar pacote…' }).click()
    const importDialog = page.getByRole('dialog', { name: 'Importar pacote de estudo' })
    await expect(importDialog.getByRole('combobox', { name: 'Curso local para Curso E2E' })).toHaveValue(/\d+/)
    await importDialog.getByRole('button', { name: 'Importar', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Pacote importado' }).getByText(/1 baralho com 1 carta/)).toBeVisible()

    const decks = await page.evaluate(() => window.api.decks.list())
    const copies = decks.filter((d) => d.title === 'Baralho da IA')
    expect(copies).toHaveLength(2)
    const imported = await page.evaluate((id) => window.api.decks.get(id), Math.max(...copies.map((d) => d.id)))
    expect(imported.cards[0]).toMatchObject({ front: 'O que a legenda diz?', lessonTitle: 'Boas-vindas' })
  } finally {
    await app.close()
  }
})
