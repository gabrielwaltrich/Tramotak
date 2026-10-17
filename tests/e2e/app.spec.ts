import { execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { makePdf } from '../helpers/pdf'

const FIXTURE = join(__dirname, 'fixtures', 'Curso E2E')

let workdir: string

/**
 * Encerra o app à força. No Windows, matar só o processo principal deixa os filhos do Chromium vivos, segurando
 * arquivos do perfil: encerra a árvore inteira.
 */
async function killApp(proc: ChildProcess): Promise<void> {
  const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r))
  if (process.platform === 'win32' && proc.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      proc.kill()
    }
  } else {
    proc.kill('SIGKILL')
  }
  await exited
}
let coursePath: string
let userData: string

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const args = ['.', `--user-data-dir=${userData}`]
  // Runners Linux de CI não têm o helper SUID do sandbox do Chromium.
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')
  // Janela flutuante como janela do próprio app (no Wayland seria um processo separado, fora do alcance do Playwright).
  const app = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'production', TRAMOTAK_PIP_MODE: 'window' } })
  // O seletor de pasta é nativo: no teste ele devolve direto a pasta do curso.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, coursePath)
  const page = await app.firstWindow()
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible()
  // No Windows do CI o Electron às vezes demora minutos para sair (e o teste estoura o tempo, levando o perfil
  // compartilhado junto). Dá 15 s para fechar normalmente; depois, encerra o processo.
  // O close() do Playwright pode voltar antes de o processo terminar de sair. Abrir o app de novo nesse meio-tempo
  // encontra o armazenamento da janela ainda travado pelo processo antigo, e o localStorage vem vazio.
  const proc = app.process()
  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) resolve()
    else proc.once('exit', () => resolve())
  })
  const close = app.close.bind(app)
  app.close = async () => {
    // Grava o localStorage antes: se o fechamento estourar o prazo e o processo for encerrado, nada se perde.
    await app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => undefined)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), 15_000)))
    const started = Date.now()
    const result = await Promise.race([
      close().then(async () => {
        const closedAt = Date.now()
        await exited
        if (Date.now() - closedAt > 200) console.log(`Electron saiu ${Date.now() - closedAt} ms depois do close()`)
        return 'closed' as const
      }),
      timeout
    ])
    clearTimeout(timer)
    if (result === 'timeout') {
      console.log(`Electron não saiu em ${Date.now() - started} ms; encerrando o processo`)
      await killApp(proc)
    }
  }
  return { app, page }
}

test.beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'tramotak-e2e-'))
  coursePath = join(workdir, 'Curso E2E')
  userData = join(workdir, 'profile')
  await cp(FIXTURE, coursePath, { recursive: true })
})

test.afterAll(async () => {
  // No Windows, arquivos do perfil podem ficar presos por alguns instantes depois que o app sai.
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
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

test('busca global: barra superior e Ctrl+K encontram a anotação e abrem o vídeo no horário dela', async () => {
  const { app, page } = await launch()
  // A barra de pesquisa do topo: digitar com ela focada abre a busca já com a letra
  const bar = page.getByRole('button', { name: /Buscar cursos, aulas/ })
  await bar.focus()
  await page.keyboard.press('p')
  await expect(page.getByRole('combobox', { name: 'Buscar' })).toHaveValue('p')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: 'Buscar' })).toHaveCount(0)

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
  // FSRS: carta nova respondida "Fácil" vai para ~8 dias (a prévia não tem variação aleatória)
  await expect(page.getByRole('button', { name: /Fácil\s*8 dias/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ver na aula: Boas-vindas/ })).toHaveAttribute('href', /#\/lesson\/\d+\?t=\d+/)
  await page.keyboard.press('4')
  await expect(page.getByText('Parabéns! Você terminou este baralho por hoje.')).toBeVisible()

  // A carta passou a ser revisão, para daqui a 6–10 dias (8 com a variação aleatória)
  await page.getByRole('link', { name: 'Ver baralho' }).click()
  await expect(page.getByText('Revisão')).toBeVisible()
  await expect(page.getByText(/^em (6|7|8|9|10) dias$/)).toBeVisible()
  await expect(page.getByText('Revisão')).toHaveAttribute('title', /Chance de lembrar hoje: 100%/)
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
  // O item sai da lista na hora (atualização otimista): `check()` falharia ao conferir um elemento já removido.
  await page.getByRole('checkbox', { name: 'Concluir Revisar o primeiro módulo' }).click()
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

test('plano de estudos: prévia, aulas distribuídas no Planner e no Início, e apagar', async () => {
  const { app, page } = await launch()
  await page.getByRole('link', { name: 'Meus Cursos' }).click()
  await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
  await page.getByRole('button', { name: /Criar plano de estudos/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Minutos por dia' }).click()
  await dialog.getByRole('button', { name: '15 min' }).click()
  // Todos os dias da semana, para hoje ter aula em qualquer dia em que o teste rodar
  for (const day of ['Dom', 'Sáb']) await dialog.getByRole('button', { name: day, exact: true }).click()
  await expect(dialog.getByText('Aulas que faltam')).toBeVisible()
  await expect(dialog.getByText('Termina em')).toBeVisible()
  await dialog.getByRole('button', { name: 'Criar plano', exact: true }).click()
  await expect(page.getByText(/Plano salvo: termina em/)).toBeVisible()

  const card = page.getByRole('region', { name: 'Plano de estudos de Curso E2E' })
  await expect(card.getByText(/^Termina em/)).toBeVisible()
  await expect(card.getByText(/^Hoje ·/)).toBeVisible()
  await expect(card.getByRole('link', { name: /Segunda aula/ })).toBeVisible()

  // Planner e Início mostram o dia de hoje do plano, com as aulas
  await page.getByRole('link', { name: 'Planner' }).click()
  await expect(page.getByRole('region', { name: 'Plano de estudos de Curso E2E' })).toBeVisible()
  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('link', { name: /Segunda aula/ }).first().click()
  await expect(page.getByRole('heading', { name: /Segunda aula/ })).toBeVisible()

  // Apagar o plano tira as tarefas pendentes dele
  await page.getByRole('link', { name: 'Meus Cursos' }).click()
  await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
  await page.getByRole('button', { name: 'Editar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apagar plano' }).click()
  await expect(page.getByText(/Plano apagado/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Criar plano de estudos/ })).toBeVisible()
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

test('anotações: todas num lugar só, busca e envio para um caderno com horário clicável', async () => {
  const { app, page } = await launch()
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Anotações' }).click()
  await expect(page.getByRole('heading', { name: 'Anotações', exact: true })).toBeVisible()
  const lesson = page.getByRole('region', { name: /Boas-vindas/ })
  await expect(lesson.getByText('Minha primeira anotação')).toBeVisible()
  await expect(page.getByText(/1 anotação em 1 aula/)).toBeVisible()

  await page.getByLabel('Buscar nas anotações').fill('nada disso')
  await expect(page.getByText('Nenhuma anotação encontrada.')).toBeVisible()
  await page.getByLabel('Buscar nas anotações').fill('primeira')
  await lesson.getByRole('checkbox', { name: 'Selecionar anotação' }).check()
  await expect(page.getByText('1 selecionada')).toBeVisible()

  await page.getByRole('button', { name: 'Enviar para caderno' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Caderno', { exact: true }).selectOption({ label: 'Novo caderno…' })
  await dialog.getByLabel('Nome do caderno novo').fill('Resumo do Curso E2E')
  await dialog.getByRole('button', { name: 'Enviar' }).click()
  await expect(dialog.getByText(/1 anotação enviada para Resumo do Curso E2E/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Abrir caderno' }).click()

  // No caderno: atalho para a aula e o horário como link que abre o vídeo naquele ponto
  await expect(page.getByRole('button', { name: /Aula\s*Boas-vindas/ })).toBeVisible()
  const time = page.getByRole('link', { name: /^\d+:\d\d$/ })
  await expect(time).toHaveAttribute('href', /^#\/lesson\/\d+\?t=\d+$/)
  await time.click()
  await expect(page.getByRole('heading', { name: /Boas-vindas/ })).toBeVisible()
  await expect(page).toHaveURL(/#\/lesson\/\d+\?t=\d+/)
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
    // Por padrão só a fala da aula (legenda) vai para a IA; as anotações ficam desmarcadas
    await expect(page.getByRole('checkbox', { name: /Legenda · \d+ caracteres/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /Minhas anotações/ })).not.toBeChecked()
    // A legenda do curso de teste é curta demais sozinha; as anotações entram quando a pessoa marca
    await expect(page.getByText(/Material curto demais/)).toBeVisible()
    await page.getByRole('checkbox', { name: /Minhas anotações/ }).check()
    await page.getByRole('button', { name: 'Gerar flashcards' }).click()

    await expect(page.getByText('Revisar e salvar · flashcards')).toBeVisible()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ model: 'modelo-teste', format: 'json' })
    expect(received[0].user).toContain('Olá, legenda de teste')
    expect(received[0].user).toContain('## Anotações do estudante')
    expect(received[0].user).toContain('Minha primeira anotação')
    expect(received[0].user).not.toContain('Boas-vindas')
    expect(received[0].user).not.toContain('Curso E2E')

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

test('conversa com a IA: resposta em tempo real só com a fala da aula e horário clicável', async () => {
  const { createServer } = await import('node:http')
  const received: { system: string; user: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-teste' }))
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
    const data = JSON.parse(body)
    received.push({ system: data.messages[0].content, user: data.messages.at(-1).content })
    res.setHeader('content-type', 'application/x-ndjson')
    for (const piece of ['A aula diz ', '“olá” logo no início [0:00].']) res.write(JSON.stringify({ message: { content: piece } }) + '\n')
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const { app, page } = await launch()
  try {
    await page.evaluate((url) => window.api.settings.update({ aiProvider: 'ollama', ollamaUrl: url, aiModels: { gemini: 'g', openrouter: 'o', ollama: 'modelo-teste', anthropic: 'a', openai: 'x' } }), `http://127.0.0.1:${port}`)
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
    await page.getByRole('link', { name: /Boas-vindas/ }).click()
    await page.getByRole('tab', { name: 'Perguntar à IA' }).click()
    await expect(page.getByText(/Base: legenda do curso/)).toBeVisible()

    const input = page.getByRole('textbox', { name: 'Pergunta para a IA' })
    await input.fill('O que a aula fala no começo?')
    await input.press('Enter')
    await expect(page.getByText('“olá” logo no início')).toBeVisible()

    // Só a fala, com marcas de tempo; sem título da aula nem nome do curso
    expect(received).toHaveLength(1)
    expect(received[0].system).toContain('[0:00] Olá, legenda de teste')
    expect(received[0].system).not.toContain('Boas-vindas')
    expect(received[0].system).not.toContain('Curso E2E')
    expect(received[0].user).toMatch(/^\[momento do vídeo: 0:\d\d\] O que a aula fala no começo\?$/)

    // O horário da resposta vira botão que leva o vídeo até ele
    const video = page.locator('video')
    await video.evaluate((v: HTMLVideoElement) => {
      v.pause()
      v.currentTime = 5
    })
    await page.getByRole('button', { name: 'Ir para 0:00 no vídeo' }).click()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1)

    // A conversa fica salva na aula
    await page.getByRole('tab', { name: /Anotações/ }).click()
    await page.getByRole('tab', { name: 'Perguntar à IA' }).click()
    await expect(page.getByText('O que a aula fala no começo?')).toBeVisible()
  } finally {
    await app.close()
    server.close()
  }
})

test('conversa sobre o curso: termos pela IA, busca local, só trechos sem títulos e citação que abre a aula no minuto', async () => {
  const { createServer } = await import('node:http')
  const received: { format: string; system: string; user: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-teste' }))
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
    const data = JSON.parse(body)
    received.push({ format: data.format ?? '', system: data.messages[0].content, user: data.messages.at(-1).content })
    if (data.format === 'json') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ terms: ['legenda', 'saudação'] }) } }))
    }
    const ref = /\[(A\d+ \d+:\d{2})\] Olá/.exec(data.messages[0].content)?.[1] ?? 'nada'
    res.setHeader('content-type', 'application/x-ndjson')
    res.write(JSON.stringify({ message: { content: `A saudação está em [${ref}].` } }) + '\n')
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const { app, page } = await launch()
  try {
    await page.evaluate((url) => window.api.settings.update({ aiProvider: 'ollama', ollamaUrl: url, aiModels: { gemini: 'g', openrouter: 'o', ollama: 'modelo-teste', anthropic: 'a', openai: 'x' } }), `http://127.0.0.1:${port}`)
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
    await page.getByRole('button', { name: 'Perguntar ao curso' }).click()
    const panel = page.getByRole('complementary', { name: 'Perguntar ao curso' })
    // Legenda da aula de vídeo e o texto do Leia-me entram; a segunda aula (sem legenda) não
    await expect(panel.getByText(/Base: 2 de 3 aulas/)).toBeVisible()

    await panel.getByRole('textbox', { name: 'Pergunta sobre o curso' }).fill('Onde está a saudação?')
    await page.keyboard.press('Enter')
    const cite = panel.getByRole('button', { name: /Abrir Boas-vindas · 0:0\d/ })
    await expect(cite).toBeVisible()
    await expect(panel.getByText(/1 trecho de 1 aula/)).toBeVisible()

    // 1º pedido: termos de busca (JSON); 2º: resposta só com os trechos, sem títulos nem nome do curso
    expect(received.map((r) => r.format)).toEqual(['json', ''])
    expect(received[0].user).toContain('Onde está a saudação?')
    const material = received[1].system.slice(received[1].system.lastIndexOf('<material>'))
    expect(material).toMatch(/### A\d+\n\[A\d+ 0:0\d\] Olá, legenda de teste/)
    expect(material).not.toContain('Boas-vindas')
    expect(material).not.toContain('Curso E2E')

    // A conversa fica salva; a citação abre a aula no minuto
    await page.reload()
    await expect(page.getByRole('complementary', { name: 'Perguntar ao curso' }).getByText('Onde está a saudação?')).toBeVisible()
    await page.getByRole('complementary', { name: 'Perguntar ao curso' }).getByRole('button', { name: /Abrir Boas-vindas/ }).click()
    await expect(page.getByRole('heading', { name: 'Boas-vindas' })).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toMatch(/#\/lesson\/\d+\?t=\d+/)

    // Fecha o painel (a escolha fica guardada para os próximos testes)
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
    await page.getByRole('button', { name: 'Fechar a conversa' }).click()
  } finally {
    await app.close()
    server.close()
  }
})

test('revisão pós-aula: ao terminar o vídeo, perguntas só da fala da aula, correção na hora e erradas viram flashcard', async () => {
  // Legenda mais longa só neste teste: a revisão precisa de material suficiente
  const { readFile, writeFile } = await import('node:fs/promises')
  const srt = join(coursePath, '01. Primeiro módulo', '01. Boas-vindas.pt-BR.srt')
  const original = await readFile(srt, 'utf8')
  await writeFile(
    srt,
    `${original.trimEnd()}\n\n2\n00:00:01,000 --> 00:00:02,000\nO comando ls lista os arquivos de um diretório e o comando cd muda o diretório atual.\n\n3\n00:00:02,000 --> 00:00:03,000\nO kernel é a parte do sistema operacional que conversa diretamente com o hardware da máquina.\n`
  )

  const { createServer } = await import('node:http')
  const received: { system: string; user: string; format: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-teste' }))
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
    const data = JSON.parse(body)
    received.push({ system: data.messages[0].content, user: data.messages.at(-1).content, format: data.format })
    const questions = [
      { type: 'single', statement: 'Qual comando lista os arquivos de um diretório?', options: ['ls', 'cd', 'pwd'], correct: [0], explanation: 'O ls lista o conteúdo.' },
      { type: 'truefalse', statement: 'No vídeo, o professor usou o comando ls.', answer: true },
      { type: 'truefalse', statement: 'O kernel conversa diretamente com o hardware.', answer: true, explanation: 'É o núcleo do sistema.' }
    ]
    res.end(JSON.stringify({ message: { content: JSON.stringify({ questions }) } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const { app, page } = await launch()
  try {
    await page.evaluate(
      (url) =>
        window.api.settings.update({
          aiProvider: 'ollama',
          ollamaUrl: url,
          aiModels: { gemini: 'g', openrouter: 'o', ollama: 'modelo-teste', anthropic: 'a', openai: 'x' },
          review: { enabled: true, count: 3 }
        }),
      `http://127.0.0.1:${port}`
    )
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso E2E' }).click()
    await page.getByRole('link', { name: /Boas-vindas/ }).click()
    await expect(page.getByRole('button', { name: /Revisão rápida/ })).toBeVisible()

    // O vídeo termina: a contagem para a próxima aula oferece a revisão, e a faixa abaixo do título também
    const video = page.locator('video')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThan(0)
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = Math.max(0, v.duration - 0.3)
      void v.play()
    })
    await expect(page.getByText(/Próxima aula em/)).toBeVisible()
    await expect(page.getByText('Aula concluída. Que tal 3 perguntas rápidas sobre o assunto?')).toBeVisible()
    await page.getByRole('button', { name: 'Revisar (3 perguntas)' }).click()
    const dialog = page.getByRole('dialog', { name: 'Revisão rápida' })
    await expect(dialog.getByText('Pergunta 1 de 2')).toBeVisible()
    // A contagem parou: continua na mesma aula
    await page.waitForTimeout(1500)
    await expect(page.getByRole('heading', { name: 'Boas-vindas' })).toBeVisible()

    // Só a fala da aula foi para a IA; a pergunta sobre o vídeo foi descartada
    expect(received).toHaveLength(1)
    expect(received[0].format).toBe('json')
    expect(received[0].user).toContain('Crie 3 questões')
    expect(received[0].user).toContain('O kernel é a parte do sistema operacional')
    expect(received[0].user).not.toContain('Boas-vindas')
    expect(received[0].user).not.toContain('Curso E2E')
    expect(received[0].user).not.toContain('Minha primeira anotação')

    // Errar pela tecla 2 (as teclas não vão para o player), virar flashcard, acertar a seguinte
    await page.keyboard.press('2')
    await expect(dialog.getByText('Não foi dessa vez.')).toBeVisible()
    await expect(dialog.getByText('O ls lista o conteúdo.')).toBeVisible()
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await dialog.getByRole('button', { name: 'Virar flashcard' }).click()
    await expect(dialog.getByText('Flashcard criado')).toBeVisible()
    await page.getByRole('button', { name: /Próxima pergunta/ }).click()
    await expect(dialog.getByText('Pergunta 2 de 2')).toBeVisible()
    await dialog.getByRole('radio', { name: 'Verdadeiro' }).click()
    await expect(dialog.getByText('Certo!')).toBeVisible()
    await page.getByRole('button', { name: /Ver resultado/ }).click()
    await expect(dialog.getByText('Você acertou 1 de 2.')).toBeVisible()
    // A errada já virou carta: não oferece criar de novo
    await expect(dialog.getByRole('button', { name: /Criar o flashcard/ })).toHaveCount(0)

    const cards = await page.evaluate(async () => {
      const course = (await window.api.courses.list()).find((c) => c.title === 'Curso E2E')!
      const deck = await window.api.decks.get(await window.api.decks.forCourse(course.id))
      return deck.cards.map((c) => ({ id: c.id, front: c.front, back: c.back, lesson: c.lessonTitle }))
    })
    const card = cards.find((c) => c.front === 'Qual comando lista os arquivos de um diretório?')
    expect(card).toMatchObject({ back: 'ls\n\nO ls lista o conteúdo.', lesson: 'Boas-vindas' })
    // Os testes seguintes contam as cartas do baralho do curso
    await page.evaluate((id) => window.api.cards.delete(id), card!.id)

    // Fechar e reabrir: o resultado ficou salvo e dá para refazer sem gerar de novo
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /Revisão rápida 1\/2/ })).toBeVisible()
    await page.getByRole('button', { name: /Revisão rápida/ }).click()
    await expect(dialog.getByText('Você acertou 1 de 2.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Refazer' }).click()
    await expect(dialog.getByText('Pergunta 1 de 2')).toBeVisible()
    expect(received).toHaveLength(1)
    await page.keyboard.press('Escape')

    // Desligada nas Configurações: sem oferta ao concluir, mas o botão continua
    await page.evaluate(() => window.api.settings.update({ review: { enabled: false, count: 3 } }))
    await page.reload()
    await expect(page.getByRole('button', { name: /Revisão rápida/ })).toBeVisible()
    await page.getByRole('button', { name: 'Concluída' }).click()
    await page.getByRole('button', { name: 'Concluir' }).click()
    await expect(page.getByText(/Que tal 3 perguntas/)).toHaveCount(0)
    await page.evaluate(() => window.api.settings.update({ review: { enabled: true, count: 4 } }))
  } finally {
    await app.close()
    server.close()
    await writeFile(srt, original)
  }
})

test('PDF no leitor do app: busca, grifo, anotação na página, conclusão no fim, última página e anexo PDF', async () => {
  const { copyFile, mkdir, writeFile } = await import('node:fs/promises')
  const root = join(workdir, 'Curso PDF')
  await mkdir(root, { recursive: true })
  const filler = (n: number) => Array.from({ length: 34 }, (_, i) => `Linha ${i + 1} da pagina ${n}: o sistema operacional gerencia processos e memoria.`)
  await writeFile(
    join(root, '01 Apostila.pdf'),
    makePdf([
      ['Capitulo 1', ...filler(1)],
      ['Capitulo 2', 'Containers compartilham o kernel do hospedeiro.', ...filler(2)],
      ['Capitulo 3', ...filler(3)]
    ])
  )
  await copyFile(join(FIXTURE, '01. Primeiro módulo', '01. Boas-vindas.mp4'), join(root, '02 Aula.mp4'))
  await writeFile(join(root, '02 Aula.pdf'), makePdf([['Resumo da aula'], ['O comando ls lista arquivos.']]))

  const { app, page } = await launch()
  let courseId: number | null = null
  try {
    courseId = await page.evaluate((path) => window.api.courses.import({ path, title: 'Curso PDF', structure: 'flat', numbering: 'none' }), root)
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso PDF' }).click()
    await page.getByRole('link', { name: /01 Apostila/ }).click()

    const reader = page.getByRole('toolbar', { name: 'Leitor de PDF' })
    const pageBox = page.getByRole('textbox', { name: 'Página', exact: true })
    await expect(reader.getByText('de 3')).toBeVisible()
    await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached({ timeout: 20_000 })

    // Busca: vai para a página com o termo e marca o trecho
    await page.getByRole('textbox', { name: 'Buscar no PDF' }).fill('hospedeiro')
    await page.keyboard.press('Enter')
    await expect(pageBox).toHaveValue('2')
    await expect(reader.getByText('1 página')).toBeVisible()
    const hit = page.locator('[data-page="2"] .textLayer span.tk-hit').first()
    await expect(hit).toBeVisible()

    // Selecionar o trecho e grifar
    const box = (await hit.boundingBox())!
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Grifar em amarelo' }).click()
    await expect(page.locator('[data-page="2"] [data-highlight]')).toHaveCount(1)
    const lessonId = await page.evaluate(() => Number(location.hash.match(/lesson\/(\d+)/)![1]))
    const highlights = await page.evaluate((id) => window.api.pdf.highlights(id, null), lessonId)
    expect(highlights).toEqual([expect.objectContaining({ page: 2, color: 'yellow', text: expect.stringContaining('hospedeiro') })])

    // Anotação pelo painel: nasce na página aberta
    await page.getByRole('button', { name: /Anotar na página 2/ }).click()
    await page.getByRole('textbox', { name: 'Nova anotação' }).fill('Diferença para máquinas virtuais')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'p. 2' })).toBeVisible()

    // Clicar no grifo: opções; remover
    await page.locator('[data-page="2"] [data-highlight]').scrollIntoViewIfNeeded()
    const mark = (await page.locator('[data-page="2"] [data-highlight]').boundingBox())!
    await page.mouse.click(mark.x + 4, mark.y + mark.height / 2)
    await page.getByRole('button', { name: 'Remover grifo' }).click()
    await expect(page.locator('[data-page="2"] [data-highlight]')).toHaveCount(0)

    // Chegar ao fim conclui a aula
    await page.locator('.tk-pdf').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(page.getByRole('button', { name: 'Concluída' })).toBeVisible()
    await expect(pageBox).toHaveValue('3')

    // Sair e voltar: reabre na última página lida
    await page.getByRole('link', { name: 'Meus Cursos' }).click()
    await page.getByRole('button', { name: 'Abrir Curso PDF' }).click()
    await page.getByRole('link', { name: /01 Apostila/ }).click()
    await expect(pageBox).toHaveValue('3')

    // A anotação na página Anotações leva de volta à página dela
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Anotações' }).click()
    await page.getByRole('link', { name: 'p. 2' }).click()
    await expect(pageBox).toHaveValue('2')

    // Anexo PDF de uma aula de vídeo abre no leitor, com grifo próprio
    await page.getByRole('link', { name: /02 Aula/ }).click()
    await page.getByRole('tab', { name: /Anexos/ }).click()
    await page.getByRole('button', { name: '02 Aula.pdf', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '02 Aula.pdf' })
    await expect(dialog.getByText('de 2')).toBeVisible()
    await expect(dialog.locator('[data-page="1"] .textLayer span').first()).toBeAttached({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

  } finally {
    // Os testes seguintes contam os cursos e anotações de antes
    if (courseId !== null) await page.evaluate((id) => window.api.courses.delete(id), courseId).catch(() => {})
    await app.close()
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

test('aparência: estilo pronto e cor de destaque mudam a interface na hora e ficam salvos', async () => {
  const { app, page } = await launch()
  try {
    await page.getByRole('link', { name: 'Configurações' }).click()
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('radiogroup', { name: 'Estilos prontos' }).getByRole('radio', { name: /Leitura/ }).click()
    await expect(root).toHaveAttribute('data-theme', 'paper')
    await expect(root).toHaveAttribute('data-font', 'serif')
    expect(await root.evaluate((el) => el.style.fontSize)).toBe('18px')

    await page.getByRole('radiogroup', { name: 'Cor de destaque' }).getByRole('radio', { name: 'Verde' }).click()
    expect(await root.evaluate((el) => el.style.getPropertyValue('--accent'))).toBe('#047857')
    await app.close()

    const second = await launch()
    const root2 = second.page.locator('html')
    await expect(root2).toHaveAttribute('data-theme', 'paper')
    expect(await root2.evaluate((el) => el.style.getPropertyValue('--accent'))).toBe('#047857')
    // Encerrado à força (como quando o fechamento trava): a aparência vem do banco, não só do localStorage.
    await second.page.evaluate(() => localStorage.clear())
    await killApp(second.app.process())
    const third = await launch()
    const root3 = third.page.locator('html')
    await expect(root3).toHaveAttribute('data-theme', 'paper')
    await third.page.getByRole('link', { name: 'Configurações' }).click()
    await third.page.getByRole('button', { name: 'Voltar ao visual padrão' }).click()
    await expect(root3).toHaveAttribute('data-theme', 'dark')
    await third.app.close()
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
})

test('pomodoro: começa pela barra superior, pausa, pula para a pausa, recomeça e as opções valem na hora', async () => {
  const { app, page } = await launch()
  try {
    await page.getByRole('button', { name: 'Pomodoro', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Pomodoro' })
    await expect(panel.getByText('25:00')).toBeVisible()
    await panel.getByRole('button', { name: 'Começar foco' }).click()
    await expect(panel.getByText(/^24:5\d$/)).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /^Pomodoro: Foco, 24:5\d$/ })).toBeVisible()

    await panel.getByRole('button', { name: 'Pausar' }).click()
    await expect(panel.getByRole('button', { name: 'Continuar' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Pomodoro: Foco, 24:5\d \(pausado\)$/ })).toBeVisible()

    // Pular o foco vai para a pausa curta (sem contar o bloco); recomeçar volta ao primeiro foco
    await panel.getByRole('button', { name: 'Pular para a pausa' }).click()
    await expect(panel.getByText('Pausa curta')).toBeVisible()
    await expect(panel.getByText('05:00')).toBeVisible()
    await expect(panel.getByText(/Hoje: 0 blocos/)).toBeVisible()
    await panel.getByRole('button', { name: 'Recomeçar' }).click()
    await expect(panel.getByText('25:00')).toBeVisible()

    // Opções nas Configurações: foco de 50 min vale para o próximo bloco
    await panel.getByRole('link', { name: 'Ajustar' }).click()
    await expect(page.locator('#pomodoro')).toBeInViewport()
    await page.getByRole('radiogroup', { name: 'Foco' }).getByRole('radio', { name: '50 min' }).click()
    await expect.poll(() => page.evaluate(() => window.api.settings.get().then((s) => s.pomodoro.focusMinutes))).toBe(50)
    await page.getByRole('button', { name: 'Pomodoro', exact: true }).click()
    await expect(panel.getByText('50:00')).toBeVisible()

    await page.evaluate(async () => {
      const s = await window.api.settings.get()
      await window.api.settings.update({ pomodoro: { ...s.pomodoro, focusMinutes: 25 } })
    })
  } finally {
    await app.close()
  }
})

test('janela flutuante: abre pelo P, comanda o vídeo, passa para a próxima aula e volta ao app', async () => {
  const { app, page } = await launch()
  const lessons = await page.evaluate(async () => {
    const course = (await window.api.courses.list()).find((c) => c.title === 'Curso E2E')!
    return (await window.api.courses.get(course.id)).modules.flatMap((m) => m.lessons).map((l) => ({ id: l.id, title: l.title }))
  })
  const welcome = lessons.find((l) => l.title === 'Boas-vindas')!
  await page.evaluate((id) => (location.hash = `#/lesson/${id}`), welcome.id)
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThan(0)
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause()
    v.currentTime = 1
  })

  const opened = app.waitForEvent('window')
  await page.keyboard.press('p')
  const pip = await opened
  await expect(page.getByText('Tocando na janela flutuante')).toBeVisible()
  const pipVideo = pip.locator('video')
  await expect.poll(() => pipVideo.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThan(0)
  expect(await pipVideo.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 0)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isAlwaysOnTop()))).toBe(true)
  // A aula anterior é texto: não aparece como "aula anterior" na janela
  await expect(pip.getByRole('button', { name: /Aula anterior/ })).toHaveCount(0)

  // Tocar e avançar até o fim: aula concluída, contagem e a janela (e o app) passam para a próxima
  await pip.getByRole('button', { name: /Reproduzir/ }).click()
  await expect.poll(() => pipVideo.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.2)
  await pip.mouse.move(100, 60)
  await pip.getByRole('button', { name: /Avançar 10 s/ }).click()
  await expect(pip.getByText(/Próxima aula em/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Segunda aula' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Tocando na janela flutuante')).toBeVisible()
  await expect.poll(() => pipVideo.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5)

  // Voltar ao app: a janela fecha e o player daqui continua tocando
  await pip.mouse.move(120, 70)
  const closed = pip.waitForEvent('close')
  await pip.getByRole('button', { name: 'Voltar ao Tramotak' }).click()
  await closed
  await expect(page.getByText('Tocando na janela flutuante')).toHaveCount(0)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.5)).toBe(true)

  // Pelo botão do player e de volta pelo app ("Trazer de volta para cá")
  await video.hover({ force: true })
  const reopened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'Janela flutuante' }).click()
  const pip2 = await reopened
  await expect(page.getByText('Tocando na janela flutuante')).toBeVisible()
  const closed2 = pip2.waitForEvent('close')
  await page.getByRole('button', { name: 'Trazer de volta para cá' }).click()
  await closed2
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)

  // Preferências da janela nas configurações
  await page.getByRole('link', { name: 'Configurações' }).click()
  await page.getByRole('radiogroup', { name: 'Voltar/avançar' }).getByRole('radio', { name: '30 s' }).click()
  await expect.poll(() => page.evaluate(() => window.api.settings.get().then((s) => s.pip.seekStep))).toBe(30)
  await app.close()
})
