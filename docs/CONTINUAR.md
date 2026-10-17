# Onde paramos (atualizado em 16/10/2026)

## Estado atual

- **Última versão publicada: v0.7.2** (backup numa pasta escolhida, instância única e primeira execução guiada com
  curso de exemplo: as primeiras partes da 0.9), só para **Windows e Linux**. Release: https://github.com/gabrielwaltrich/Tramotak/releases/tag/v0.7.2
- Testes no momento da publicação: 506 unitários (Vitest) e 22 E2E (Playwright), lint e typecheck limpos, CI verde
  no Windows e no Linux.
- `main` está igual à v0.7.2; não há trabalho pela metade. Próximo passo: o resto da **0.9** (ver abaixo).
- Ambiente local: o sistema traz Node 18; o projeto precisa do **Node 22** (o mesmo do CI), instalado em
  `~/.local/lib/node22/bin` (pôr no `PATH` antes de `npm`/testes/build).
- O dono do projeto usa o Tramotak instalado pelo **`.deb`** (em `/opt/Tramotak`) e estuda o curso "DevOps PRO 2"
  (1.092 aulas, nomes de arquivo como `#F0009_2026-02-20_01_Título_By_@autor`).

### O que cada versão recente trouxe

| Versão | Principal |
|---|---|
| 0.5.0 | Atualização automática (electron-updater), Whisper embutido (whisper.cpp), transcrever o curso inteiro, regras de nomes das aulas, durações medidas pelo FFmpeg |
| 0.6.0 | Plano de estudos por curso (data-alvo ou minutos por dia, tarefas no Planner, replanejamento), **FSRS-6** no lugar do SM-2 com opções por baralho, aparência salva no banco, macOS descontinuado |
| 0.6.1 | Aba **Anotações** (todas as notas, busca, filtro, exportar `.md`) e envio de notas para os **cadernos** com horários clicáveis |
| 0.6.2 | **Janela flutuante** do player (sempre por cima, transparência, ±10 s, próxima aula, opções); no Wayland, processo separado em X11 |
| 0.6.3 | **Revisão pós-aula**: 3 a 5 perguntas da IA ao concluir (sem parar o autoplay), transcreve antes se preciso, erradas viram flashcard |
| 0.7.0 | **PDFs no leitor do app** (grifos, anotações por página, anexos PDF, texto para a IA, conclui na última página) e **Pomodoro** (foco conta na meta sem duplicar) |
| 0.7.1 | **IA no curso inteiro**: conversa sobre o curso (busca nas aulas, cita aula e minuto) e gerar flashcards/questões do curso ou de módulos, N por aula, salvando direto |
| 0.7.2 | **Backup numa pasta sua** (Drive/Dropbox/pendrive, diário e ao fechar), **uma cópia do app por vez**, **primeira execução guiada** e curso de exemplo "Como usar o Tramotak" |

Detalhes de cada uma em `docs/releases/` e no `docs/ROADMAP-1.0.md`.

## 0.7 — PDFs, revisão pós-aula e Pomodoro ✅ (publicada: v0.6.3 e v0.7.0)

O dono prefere publicar partes prontas como versão de correção (ex.: 0.6.1) em vez de esperar a versão inteira.
Perguntar ao terminar cada parte. O que ficou registrado de cada parte (para quem mexer nelas):

### 1. PDFs como aula ✅ (publicado na v0.7.0)
- Leitor com o `pdfjs-dist` 6 (`components/pdf/`): páginas desenhadas só perto da tela, zoom (Ctrl+roda, ajustar
  à largura), busca no texto, ← → entre páginas. Grifos em 4 cores pela seleção (clique no grifo: cor, anotar,
  remover) e anotação pela seleção ou pelo painel ("Anotar na página N"). Nada é escrito no PDF.
- Decisões do dono: **anexos PDF** de aulas de vídeo também abrem no leitor (janela grande), com grifos e notas
  na aula; a aula em PDF **conclui ao chegar na última página** (e oferece a revisão pós-aula).
- Banco (migration 13): `notes.page` e `notes.asset_path`, tabela `pdf_highlights` (retângulos em fração da
  página). O anexo é guardado pelo **caminho no curso**, não pelo id (reescanear recria os anexos). Nas aulas em
  PDF, `lesson_progress.position_sec` guarda a última página; o tempo de leitura conta com janela em foco e
  atividade recente (`useReadingTime`). Ler anexo só soma tempo (`positionSec: null` não mexe na posição).
- IA: texto extraído no processo principal (`src/main/pdf/text.ts`, cache em memória) vira material padrão da
  aula em PDF; anexos PDF entram em "Anexos" (desmarcado). A conversa cita `[p. N]` (clicável) e recebe a página
  aberta. Links internos `#/lesson/ID?p=N` (e `&a=caminho` para anexo) nas Anotações, busca e cadernos.
- Não feito: PDF escaneado (sem texto) não tem OCR; grifos não vão nos pacotes `.tramotak` (as notas com página
  vão); texto dos PDFs não entra na busca global.

### 2. Revisão pós-aula ✅ (publicada na v0.6.3)
- Ao concluir (fim do vídeo ou botão Concluir), faixa "Que tal N perguntas rápidas?" e, com o autoplay, o botão
  na contagem da próxima aula (que sobe de 3 para 10 s). Botão **Revisão rápida** no cabeçalho a qualquer hora.
- Decisões do dono: oferecer sem parar o autoplay; numa aula sem material, **Transcrever e revisar** (usa o
  provedor de transcrição configurado); gerar **só ao clicar** (nada de pré-gerar). As perguntas ficam salvas
  por aula (migration 12, `lesson_reviews`) para refazer sem gastar IA; "Novas perguntas" gera outras.
- Só múltipla escolha e verdadeiro/falso, corrigidas na hora; teclas 1–5 e Enter. Erradas viram flashcard no
  baralho do curso (`deckForCourse`) com um clique, uma a uma ou todas no fim.
- Código: `src/shared/review.ts` (pedido, carta, acerto), `src/main/db/reviews.ts`, `reviewMaterial` em
  `src/main/ai/source.ts`, handlers `review:*` em `src/main/ipc/ai.ts`, `components/review/` (diálogo e
  configuração em Configurações → Inteligência artificial).
- Não feito: oferta quando a aula termina na janela flutuante (só no player do app).

### 3. Pomodoro / modo foco ✅ (publicado na v0.7.0)
- Botão na barra superior (`components/pomodoro/`): tempo da fase, painel com começar/pausar/pular/recomeçar,
  sequência até a pausa longa e o estudo do dia contra a meta. Opções em Configurações → Pomodoro (foco, pausas,
  pausa longa a cada N, início automático, aviso).
- O relógio fica no processo principal (`src/main/pomodoro.ts`, lógica pura em `src/shared/pomodoro.ts`): segue
  ao trocar de tela, avisa com a janela minimizada e guarda o estado no banco (`internal.pomodoro`). Ao sair do
  app, o foco é pausado; se o app cair rodando, reabre pausado sem somar o tempo fechado.
- Decisões do dono: o bloco de foco conta **inteiro** no tempo de estudo e na meta, **descontando** o que o app já
  mediu no período (vídeo, PDF, flashcards; `focusCredit`); o Pomodoro **não mexe no vídeo**.
- Banco (migration 14): `study_sessions.source` ('pomodoro' = bloco de foco); `recordStudyTime` não junta sessões
  do app com as do Pomodoro.

### Pendências pequenas (boas para entrar junto)
- **FSRS**: otimizar os parâmetros com o histórico da pessoa (hoje usa os padrões do Anki) e oferecer reagendar as
  cartas quando a retenção desejada muda.
- Os `.dmg` de macOS das versões 0.2.0–0.5.0 continuam nas Releases antigas. **Só apagar se o dono pedir**
  (é irreversível).

## A validar com o dono

- Janela flutuante no dia a dia: arrastar com o mouse real e uso em dois monitores. A transparência sobre outras
  janelas foi conferida numa captura da tela real (sessão X11, 16/10); o modo processo separado (Wayland) só foi
  testado na sessão Wayland de 14/10.

- PDFs reais grandes e com imagens no leitor (os testes usaram PDFs gerados) e o fim de um bloco do Pomodoro com o
  relógio de verdade (aviso do sistema).
- A primeira atualização automática real pelo `.deb` (para a 0.7.2): deve aparecer "Atualizar para 0.7.2" na barra
  superior, pedir a senha do sistema e reabrir na versão nova.
- Backup numa pasta do Google Drive ou do Dropbox de verdade (os testes usaram pasta local e pasta removida).
- Instalação e atualização no Windows de verdade (só o CI testou).
- IA e pesquisa na internet com chaves e contas reais.

## 0.8 — IA no curso inteiro ✅ (publicada na v0.7.1)

### 1. Conversa sobre o curso inteiro ✅ (publicada na v0.7.1)
- Painel "Perguntar ao curso" na página do curso (`components/ai/CourseChat.tsx`; fica aberto/fechado como a
  pessoa deixou). As respostas citam `[A9 12:34]` / `[A9 p. 3]`, que viram botões com o título da aula e o minuto.
- Decisões do dono: a **IA sugere termos de busca** (um pedido curto em JSON) e a **busca é local** (FTS5); o
  painel fica **na página do curso**.
- Como funciona (`src/shared/courseChat.ts`, `src/main/ai/courseIndex.ts`, handlers `ai:courseChat*` em
  `src/main/ipc/ai.ts`): o material das aulas (transcrição > legenda; texto; PDF) vira trechos de ~900 caracteres na
  tabela FTS5 `course_chunks` (migration 15), refeitos só quando o material muda (`chunk_sources.version`). Cada
  pergunta: termos da IA + palavras da pergunta → consulta OR → trechos até 40 mil caracteres (ou o limite do
  provedor) → resposta em streaming. Cada aula vai só com o código "A" + posição no curso; **títulos nunca vão para
  a IA**. A mensagem guarda `refs` (código → aula) e `consulted` (trechos, aulas, termos).
- Conversas por curso em `course_chats` (somem com o curso).

### 2. Gerar flashcards e questões do curso inteiro ✅ (publicado na v0.7.1)
- Na tela IA, origem **Curso inteiro** (`components/ai/CourseGenerate.tsx`; atalho na página do curso,
  `/ai?course=ID`): módulos (nenhum = o curso todo), flashcards ou questões, **N por aula com teto total**, instruções
  e destino (baralho/banco existente ou novo; o novo fica escolhido para outra rodada).
- Decisões do dono: **salva direto** no baralho/banco (revisa depois lá) e quantidade **por aula, com teto**.
- `src/main/ai/courseGenerate.ts`: um pedido por aula com material (o texto vem dos trechos de `course_chunks`, sob
  cabeçalho neutro), salvando na hora com `lessonId` nas cartas; descarta repetidos (inclusive os que já estavam no
  destino), os que falam do vídeo e o excesso por aula. Limite de uso/sobrecarga: espera e tenta de novo (2 vezes);
  3 aulas seguidas com erro param tudo. Roda no processo principal (segue fora da tela; interromper mantém o que já
  foi salvo); andamento por `ai:courseProgress`.

### Tirado do roteiro (16/10/2026)
- Tutor dos pontos fracos / "explique meu erro" e custo estimado antes de gerar: o dono decidiu que não seriam úteis.
  Nada disso chegou a ser implementado. Não retomar sem ele pedir.

## 0.9 — Polimento e beta (em andamento)

### 1. Backup numa pasta escolhida + instância única ✅ (publicado na v0.7.2)
- Configurações → Dados e backup → **Cópia numa pasta sua** (`components/backup/BackupSettings.tsx`): escolher pela
  janela do sistema (a interface nunca manda caminho), gravar agora, trocar, parar de usar, lista com Restaurar.
- Decisões do dono: arquivos **datados, 7 mais recentes** (`Tramotak-auto-AAAA-MM-DD-HHMM.db`; o app só apaga os
  automáticos dele, nunca outros arquivos da pasta); grava **um por dia e ao fechar o app, se algo mudou**; se a pasta
  falhar, **erro nas Configurações e aviso no Início depois de 3 dias**; **sem senha** (mesmo `.db` dos backups locais,
  sem as chaves de API).
- `src/main/backup/folder.ts`: o banco vai primeiro para `backup-tmp/` (VACUUM INTO, rápido e consistente) e depois
  para a pasta como `.partial`, renomeado no fim (o Drive nunca sincroniza arquivo pela metade). Nunca cria a pasta
  (pendrive fora gravaria no disco local). Tudo com prazo (pasta de rede travada). Estado em `internal.folderBackup`
  (`path`, `lastAt`, `error`, `failingSince`…), sem migration. Restaurar da pasta copia o arquivo para `backup-tmp/`
  antes de inspecionar.
- Agenda (`scheduleAutoBackup` em `src/main/index.ts`): verifica a cada hora; a pasta grava se nunca gravou, se a
  última falhou ou depois de ~20 h, e vale mesmo com o "backup automático diário" local desligado. Ao fechar:
  `before-quit` adia a saída até 20 s se `total_changes()` subiu desde o último envio; pula durante a instalação de
  atualização.
- **Instância única**: `app.requestSingleInstanceLock()` (a janela flutuante em processo separado não entra);
  `second-instance` traz a janela para a frente. Conferido: restaurar backup e reabrir (`app.relaunch`) continua
  funcionando, e a janela flutuante em modo processo abre.
- Não validado: Google Drive/Dropbox de verdade (testado com pasta local e pasta removida) e Windows real.

### 2. Primeira execução guiada e curso de exemplo ✅ (publicada na v0.7.2)
- **Boas-vindas** (`components/onboarding/WelcomeDialog.tsx`, montada no `App.tsx`): meta diária → curso (exemplo ou
  "Importar um curso meu", que abre `/courses?import=1`) → IA opcional (`/settings#ai`). "Pular" ou Esc contam como
  concluída. **Primeiros passos** no Início (`FirstSteps.tsx`): importar um curso seu, assistir, anotar, revisar
  flashcards, simulado, IA; some ao dispensar ou concluir tudo. Configurações → Sobre: "Ver a introdução de novo" e
  pôr/tirar o curso de exemplo (`IntroSettings.tsx`).
- Decisões do dono: boas-vindas + lista; exemplo **"Como usar o Tramotak"**; **baralho (5) e banco (3) de exemplo**
  ligados às aulas; só para **quem ainda não tem cursos** (quem já usa nunca vê nada sozinho).
- Regras em `src/shared/onboarding.ts` (`onboardingView`, dados do baralho/banco); banco em `src/main/onboarding.ts`
  (`internal.onboarding` e `internal.sampleCourse`, sem migration). `welcome: 'requested'` = aberta até concluir: vale
  para "ver de novo" e para quando o exemplo vira o primeiro curso no meio das boas-vindas (senão elas fechariam).
- Curso em `resources/sample-course/` (vai como `extraResources` → `sample-course`; em desenvolvimento e no E2E, lido do
  repositório). Ao instalar, é copiado para `<dados>/exemplo/` (o caminho do AppImage muda a cada abertura) e importado
  como curso comum. Vídeo (slides + legenda `.srt`) e PDF gerados por `scripts/build-sample-course.ts`
  (`node --experimental-strip-types`); os `.md` são editados à mão. Reinstalar depois de apagar o curso à mão
  reaproveita o baralho e o banco que sobraram.
- Conferido no app real: perfil vazio (todas as telas, vídeo, PDF, Início), cópia do banco do dono (nada aparece) e
  app empacotado (`electron-builder --linux dir`) instalando o exemplo.

### 3. Licença e comunidade ✅ (17/10/2026)
- **GPL-3.0 ou posterior** (`LICENSE` com o texto oficial da GNU; `package.json`; o app mostra a licença em
  Configurações → Sobre, vinda de `extraResources` → `LICENSE.txt`). Antes era `UNLICENSED`, sem arquivo de licença.
  Todas as dependências de produção são compatíveis (MIT, ISC, Apache-2.0, BSD, Python-2.0, BlueOak; FFmpeg GPL).
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/` (Problema, Ideia),
  `.github/pull_request_template.md` e capturas em `docs/screenshots/` (só o curso de exemplo, nenhum dado pessoal).
- Configurações do repositório no GitHub ficam com o dono (o app não mexe): descrição, tópicos, Discussions e o aviso
  privado de segurança (que o SECURITY.md usa).

## Próximo: resto da 0.9 e 1.0
Ordem combinada (detalhes no `docs/ROADMAP-1.0.md`): **Relatar problema** → **exportar para o Anki** → pedir o
**SignPath** e publicar no **Flathub/winget** → **acessibilidade** → publicar a 0.9 e começar o **beta** → 1.0
(correções, documentação de uso, Sponsors).
