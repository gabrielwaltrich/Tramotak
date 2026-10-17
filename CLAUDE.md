# Tramotak — guia para continuar o desenvolvimento

App desktop de estudos (Electron) para cursos que a pessoa já tem no computador. Interface, documentação, commits
e conversa em **português do Brasil**.

**Onde paramos e o que vem agora:** [docs/CONTINUAR.md](docs/CONTINUAR.md). Leia antes de começar.
Roteiro até a 1.0: [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md). Plano original e decisões do MVP:
[docs/PLANO-MVP.md](docs/PLANO-MVP.md). Notas de cada versão: [docs/releases/](docs/releases/).

## Regras do dono do projeto (não negociáveis)

- **Pedir antes de commit, push, tag ou release.** Decisões de produto com impacto: perguntar antes.
- **Os arquivos dos cursos nunca são alterados** (só lidos; conversões vão para a pasta de dados do app).
- **IA só usa o conteúdo da aula** (fala/transcrição/legenda, texto do material) **ou a internet**. Nunca título da
  aula, nome do curso, nomes de arquivo nem metadados. Perguntas, flashcards e resumos são sobre o **assunto**,
  nunca sobre "o que aconteceu no vídeo". Regras em `src/shared/ai.ts` (`CONTENT_RULES`) e o filtro
  `aboutTheMedium`.
- **Chaves de API** cifradas pelo `safeStorage` (`src/main/secrets.ts`) e nunca devolvidas à interface.
- **Não usar arquivos pessoais nos testes.** Para testar com dados reais, copiar o banco do usuário (somente leitura,
  `VACUUM INTO`) para um perfil temporário no scratchpad e apagar depois.
- **Não enviar o e-mail do usuário** a nenhum serviço.
- **macOS foi descontinuado** na 0.6.0: só Windows e Linux. Não reintroduzir no CI nem no empacotamento.
- **Licença GPL-3.0 ou posterior.** Dependência nova precisa ser compatível (MIT, BSD, Apache-2.0, ISC, GPL…).
  Nada de telemetria. Regras para quem contribui no `CONTRIBUTING.md`.

## Comandos

```bash
npm ci                    # dependências
npm run dev               # app em desenvolvimento
npm run typecheck         # tsc nos 3 projetos (node, web, e2e)
npm run lint              # eslint
npm test                  # Vitest (unitários)
npx electron-vite build && npx playwright test   # E2E (Playwright + Electron)
npm run dist:linux        # instaladores em dist/ (também dist:win)
scripts/build-whisper.sh  # compila o whisper-cli embutido (build/whisper), usado no empacotamento
```

Antes de dizer que algo está pronto: `typecheck`, `lint`, `npm test` e o E2E inteiro passando.

## Arquitetura em uma olhada

- `src/main/` — processo principal: `db/` (SQLite via `node:sqlite`, SQL direto; migrations em `db/migrations.ts`,
  hoje até a **15**; nunca editar uma migration publicada, só criar nova no fim), `ipc/` (um arquivo por área,
  valida tudo que vem da interface), `media/` (FFmpeg, durações, whisper), `ai/`, `backup/` (`folder.ts`: cópia na pasta escolhida), `scanner/`,
  `updater.ts` (electron-updater), `notifier.ts` (avisos e replanejamento diário), `pomodoro.ts` (relógio do Pomodoro), `pip/` (janela flutuante:
  `host.ts` grava progresso e troca de aula; `window.ts` cria a janela; `child.ts` é o processo separado em X11
  usado no Wayland; `mode.ts` escolhe entre os dois), `pdf/text.ts` (texto dos PDFs para a IA), `ai/courseIndex.ts` (trechos pesquisáveis do curso para a conversa sobre o curso), `ai/courseGenerate.ts` (gerar do curso inteiro).
- `src/preload/index.ts` — ponte `window.api` (tipos em `src/shared/ipc.ts`, interface `TramotakApi`).
- `src/renderer/src/` — React 19 + TanStack Query + Tailwind 4 (cores por tokens CSS; temas em
  `src/shared/appearance.ts`). Uma rota por tela em `routes/`.
- `src/shared/` — lógica pura e tipos usados pelos dois lados (FSRS em `srs.ts`, plano de estudos em `studyPlan.ts`,
  anotações em `notes.ts`, regras de nomes em `titleRules.ts`…). Lógica nova testável vai aqui.
- Preferências: `settings` no banco (`src/main/db/settings.ts`, com validação). localStorage só para comodidades
  da janela; o que precisa sobreviver a um reinício vai para o banco.

## Jeito de trabalhar que deu certo

1. Ler o código da área antes de mudar; seguir o estilo vizinho (comentários em pt-BR, explicando o porquê).
2. Implementar com testes unitários (Vitest, banco `:memory:` e cursos de mentira com `tests/helpers/fixture.ts`).
3. Acrescentar ou ajustar o E2E em `tests/e2e/app.spec.ts` (os testes compartilham um perfil e rodam em ordem).
4. **Testar no app real**: `npx electron-vite build`, depois um script Playwright `_electron.launch` no scratchpad
   com `--user-data-dir` isolado (cópia do banco do usuário, se fizer sentido), tirando capturas de tela e
   olhando o resultado. Apagar a cópia no fim.
5. Corrigir o que o teste achar, resumir para o usuário (o que foi feito, testado, bugs achados, o que não foi
   validado) e perguntar sobre commit/push.

## Publicar uma versão

1. `npm version X.Y.Z --no-git-tag-version`, criar `docs/releases/vX.Y.Z.md` (mesmo formato das anteriores) e
   marcar a versão no `docs/ROADMAP-1.0.md`.
2. Commit (mensagem em pt-BR, terminando com `Co-Authored-By: Claude …`) e push **por SSH**:
   `git push git@github.com:gabrielwaltrich/Tramotak.git main` (o `origin` é HTTPS sem credencial).
3. Rodar também `gh workflow run ci.yml --ref main` (gera os instaladores sem publicar) e esperar **os dois runs
   verdes** (`gh run watch <id> --exit-status`, conferir `exit=0`).
4. `git tag -a vX.Y.Z -m "Tramotak X.Y.Z" <commit>` e push da tag → o CI testa, gera os instaladores e cria a Release
   com `SHA256SUMS.txt` e os `latest*.yml` da atualização automática.
5. Conferir: `gh release view vX.Y.Z`, checksum do `.deb`, `latest*.yml` com a versão nova e
   `gh api repos/gabrielwaltrich/Tramotak/releases/latest --jq .tag_name`.
6. Se a tag falhar antes de existir Release, dá para recriá-la no commit corrigido (ninguém foi afetado).

## Armadilhas conhecidas

- **E2E instável**: se o mesmo teste falhar na 1ª tentativa em mais de um run, não é acaso. Baixar o trace
  (`gh run download <id> -n playwright-report-<so>`) antes de só repetir. O fechamento do Electron no CI às vezes
  trava; o helper `launch` do E2E espera o processo sair, encerra após 15 s e, no Windows, mata a árvore
  (`taskkill /T /F`).
- `pkill -f` com um padrão que aparece no próprio comando mata o shell: montar o padrão com variável.
- No AppImage e no `.exe` portátil, `app.relaunch()` não funciona (a restauração de backup avisa e fecha).
- Ids gerados para blocos/itens devem ser aleatórios (`randomUUID`), nunca só `Date.now()`.
- **Janela flutuante no Linux**: o app roda em Wayland nativo (Electron 44), onde nenhuma janela fica "sempre por
  cima" e `setPosition` não funciona; por isso a janela flutuante é um processo separado com
  `--ozone-platform=x11` (o mesmo executável com `--tramotak-pip`). `app.commandLine.appendSwitch('ozone-platform')`
  no main **não** adianta (chega tarde). No X11, `setAspectRatio` conta a sombra invisível e achata o vídeo, e o
  `screenX`/`outerWidth` da página incluem essa sombra: a posição exata vem de `win.getBounds()`.
- **pdf.js**: no processo principal só o build `legacy` (extrai texto; os avisos de "polyfill DOMMatrix" são
  esperados, o canvas nativo `@napi-rs/canvas` fica fora do instalador). Na interface, fontes padrão, cmaps e wasm
  vêm pelo protocolo `tramotak-media://pdfjs/…` (por isso `font-src tramotak-media:` no CSP). O que o
  `electron-builder.yml` exclui do `pdfjs-dist` não pode ser usado em tempo de execução.
- **E2E**: se um teste falha, o Playwright reinicia o worker e os seguintes começam com um perfil vazio (falham em
  cascata). Olhe a primeira falha. Testes que criam dados que mudam contagens (cursos, cartas) devem apagá-los no fim.
- Para testar a janela flutuante: `TRAMOTAK_PIP_MODE=window|process` força o modo (o E2E usa `window`) e
  `TRAMOTAK_PIP_DEBUG_PORT=9339` abre a porta de depuração do processo separado (Playwright `connectOverCDP`).
- **Instância única**: o app pega `requestSingleInstanceLock()` na pasta de dados. Abrir o app de novo antes de o
  processo anterior sair faz a cópia nova fechar na hora; por isso o E2E espera o processo sair antes de relançar.
