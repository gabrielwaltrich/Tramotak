# Onde paramos (atualizado em 16/10/2026)

## Estado atual

- **Última versão publicada: v0.6.2** (janela flutuante), só para **Windows e Linux**.
  Release: https://github.com/gabrielwaltrich/Tramotak/releases/tag/v0.6.2
- Testes no momento da publicação: 448 unitários (Vitest) e 15 E2E (Playwright), lint e typecheck limpos, CI verde
  no Windows e no Linux.
- `main` está igual à v0.6.2; não há trabalho pela metade.
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

Detalhes de cada uma em `docs/releases/` e no `docs/ROADMAP-1.0.md`.

## Próximo passo: 0.7 — PDFs, revisão pós-aula e Pomodoro

O dono prefere publicar partes prontas como versão de correção (ex.: 0.6.1) em vez de esperar a 0.7 inteira.
Perguntar ao terminar cada parte.

### 1. PDFs como aula
- Hoje: aulas `document` (`.pdf`, `.docx`…) só mostram "Abrir arquivo" no aplicativo do sistema
  (`src/renderer/src/components/player/DocumentLesson.tsx`).
- Objetivo: abrir o **PDF dentro do app** (leitor com páginas, zoom, busca), **grifar** trechos e **anotar** com
  referência à página (as anotações de hoje usam `timestamp_sec`; para PDF faz sentido uma coluna de página, numa
  migration nova, a 12).
- Texto do PDF como **material da IA** (`src/main/ai/source.ts`, `resolveSource`), respeitando a regra de usar só
  o conteúdo.
- Os PDFs dos cursos não podem ser alterados: grifos ficam no banco, não no arquivo.
- Avaliar o `pdfjs-dist` (o caderno já gera PDF em `components/notebooks/pdf.ts`, mas isso é exportação, não leitura).

### 2. Revisão pós-aula
- Ao concluir uma aula, oferecer **3 a 5 perguntas rápidas sobre o assunto** (geradas pela IA a partir da
  transcrição/legenda; reaproveitar `buildPrompt`/`parseQuestions` de `src/shared/ai.ts`).
- Sem provedor de IA ou sem material, não mostrar (ou sugerir transcrever).
- Respostas erradas podem virar flashcards com um clique.

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
