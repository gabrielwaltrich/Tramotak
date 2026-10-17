# Onde paramos (atualizado em 16/10/2026)

## Estado atual

- **Última versão publicada: v0.6.3** (revisão pós-aula, a primeira parte da 0.7), só para **Windows e Linux**.
  Release: https://github.com/gabrielwaltrich/Tramotak/releases/tag/v0.6.3
- Testes no momento da publicação: 456 unitários (Vitest) e 16 E2E (Playwright), lint e typecheck limpos, CI verde
  no Windows e no Linux.
- **PDFs no leitor do app prontos, ainda não publicados** (segunda parte da 0.7; ver abaixo). Testes: 468
  unitários e 17 E2E.
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

Detalhes de cada uma em `docs/releases/` e no `docs/ROADMAP-1.0.md`.

## Próximo passo: 0.7 — PDFs, revisão pós-aula e Pomodoro

O dono prefere publicar partes prontas como versão de correção (ex.: 0.6.1) em vez de esperar a 0.7 inteira.
Perguntar ao terminar cada parte.

### 1. PDFs como aula ✅ (pronto em 16/10, não publicado)
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

### 3. Pomodoro / modo foco
- Temporizador (25/5 configurável) integrado ao tempo de estudo (`recordStudyTime` em `src/main/db/study.ts`) e à
  meta diária; aviso do sistema no fim de cada ciclo (`src/main/notifier.ts` já mostra notificações).

### Pendências pequenas (boas para entrar junto)
- **Instância única**: hoje dá para abrir duas cópias do Tramotak ao mesmo tempo sobre o mesmo banco. Usar
  `app.requestSingleInstanceLock()` e, na segunda abertura, focar a janela existente. Cuidado com o E2E, que abre
  e fecha o app várias vezes (ver "Armadilhas" no `CLAUDE.md`).
- **FSRS**: otimizar os parâmetros com o histórico da pessoa (hoje usa os padrões do Anki) e oferecer reagendar as
  cartas quando a retenção desejada muda.
- Os `.dmg` de macOS das versões 0.2.0–0.5.0 continuam nas Releases antigas. **Só apagar se o dono pedir**
  (é irreversível).

## A validar com o dono

- Janela flutuante no dia a dia: arrastar com o mouse real e uso em dois monitores. A transparência sobre outras
  janelas foi conferida numa captura da tela real (sessão X11, 16/10); o modo processo separado (Wayland) só foi
  testado na sessão Wayland de 14/10.

- A primeira atualização automática real pelo `.deb` (0.6.0 → 0.6.1): deve aparecer "Atualizar para 0.6.1" na barra
  superior, pedir a senha do sistema e reabrir na versão nova.
- Instalação e atualização no Windows de verdade (só o CI testou).
- IA e pesquisa na internet com chaves e contas reais.

## Depois da 0.7 (resumo do roteiro)

- **0.8** — IA no curso inteiro: conversa sobre o curso todo (citando aula e minuto), gerar baralho/questões do
  curso, tutor dos pontos fracos, custo estimado antes de gerar.
- **0.9** — Polimento e beta: primeira execução guiada, "Relatar problema", acessibilidade, backup para pasta
  escolhida, beta com usuários reais.
- **1.0** — Instalador do Windows assinado, correções do beta e documentação de uso.
