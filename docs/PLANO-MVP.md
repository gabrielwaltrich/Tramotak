# Tramotak — Plano do Objetivo 1 (MVP): Biblioteca + Player

> App desktop de estudos: o usuário importa cursos que já tem no computador e estuda com eles.
> Este documento cobre o **primeiro objetivo** e uma **UI/UX simples**. Os objetivos seguintes
> (flashcards, questões, planner etc.) estão no roadmap no fim.

---

## 1. Stack escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Shell desktop | **Electron** | Leva o próprio Chromium: o player de vídeo se comporta igual no Windows, macOS e Linux |
| Build/dev | **electron-vite** + **Vite** | HMR rápido, separa main / preload / renderer |
| UI | **React 19 + TypeScript** | Ecossistema grande, fácil achar componentes |
| Estilo | **Tailwind CSS** + **shadcn/ui** (Radix) | Componentes acessíveis, tema claro/escuro por tokens |
| Rotas | **React Router** | Uma rota por aba (`/`, `/courses`, `/courses/:id`, `/lesson/:id`) |
| Estado/dados | **TanStack Query** sobre IPC | Cache, loading e invalidação sem boilerplate |
| Banco | **SQLite** embutido (`node:sqlite`) + SQL direto | Local, um arquivo; sem módulo nativo para compilar por sistema (com FTS5 para a busca futura) |
| Empacotamento | **electron-builder** | `.exe` (NSIS/portable), `.dmg`, `.AppImage` e `.deb` |
| Testes | **Vitest** (unidade) + **Playwright** (e2e com Electron) | |
| CI | **GitHub Actions** (matriz win/mac/linux) | Gera os 3 instaladores a cada tag |

### Por que Electron e não Tauri
O coração do MVP é o **player de vídeo**. O Tauri usa o webview do sistema (WebView2 no Windows,
WKWebView no macOS, **WebKitGTK no Linux**). No Linux, o suporte a codecs depende dos plugins do
GStreamer instalados na máquina, e vídeos que tocam no Windows podem não tocar no Linux. O Electron
leva o Chromium junto, então o comportamento é **idêntico nos 3 sistemas**.
O preço é o tamanho (~120 MB contra ~10 MB). Dá para reavaliar o Tauri se no futuro quisermos mobile.

---

## 2. Escopo do Objetivo 1

### Entra
1. **Importar curso de uma pasta local**, com detecção automática da estrutura e prévia antes de importar.
2. **Meus Cursos**: catálogo em cartões, com busca, ordenação, editar, excluir e revalidar.
3. **Detalhes do curso**: árvore de módulos e aulas com progresso por módulo.
4. **Player de aula**: retoma a posição, velocidade de 0,25× a 2×, autoplay da próxima aula, legendas externas (`.vtt`/`.srt`), marcar como concluída e favorito, anexos e aulas só de texto.
5. **Anotações com timestamp** (tecla `N`), clicáveis para pular ao ponto do vídeo.
6. **Início**: saudação, "Continuar assistindo", tempo estudado hoje × meta, streak e grade de cursos.
7. **Configurações mínimas**: tema, meta diária de minutos e pasta do banco.

### Fica para depois
Busca global, flashcards, questões, planner, progresso detalhado, cadernos, mapas mentais, IA,
backups, stream, servidor de mídia, re-encode com FFmpeg e transcrição.

---

## 3. Arquitetura

```
┌──────────────────────── Electron ────────────────────────┐
│  MAIN (Node)                                              │
│   ├─ db/        node:sqlite + migrations (user_version)   │
│   ├─ scanner/   lê pasta → árvore curso/módulo/aula       │
│   ├─ protocol/  tramotak-media://  (stream c/ Range)      │
│   └─ ipc/       handlers tipados (courses, lessons, …)    │
│                        ▲  contextBridge (preload)         │
│  RENDERER (React)      │  window.api.courses.list() …     │
│   ├─ routes/   Início · Meus Cursos · Detalhes · Player   │
│   └─ ui/       shadcn + tokens de tema                    │
└───────────────────────────────────────────────────────────┘
```

**Segurança:** `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`. O renderer só
fala com o main pela API do preload. Os vídeos são servidos por um **protocolo próprio**
(`tramotak-media://lesson/<id>`), que resolve o caminho pelo ID no banco, sem expor `file://`, e
responde a `Range` para permitir avançar e voltar no vídeo.

### Contratos de IPC (MVP)
| Canal | Entrada → Saída |
|---|---|
| `scanner.preview` | `{ path, structure, numbering }` → árvore + avisos |
| `courses.import` | `{ path, structure, numbering, title }` → `courseId` |
| `courses.list` | `{ query?, sort? }` → cartões com progresso |
| `courses.get` | `id` → curso + módulos + aulas + progresso |
| `courses.update` / `courses.delete` | título e descrição / id |
| `courses.revalidate` | `id` → `{ added, removed, updated }` |
| `lessons.get` | `id` → aula + anexos + legendas + anterior/próxima |
| `progress.save` | `{ lessonId, positionSec, durationSec }` (com throttle de 5 s) |
| `progress.setCompleted` / `lessons.setFavorite` | `{ lessonId, value }` |
| `notes.list` / `notes.create` / `notes.update` / `notes.delete` | por aula |
| `dashboard.get` | → continuar assistindo, minutos de hoje, streak, cursos |
| `settings.get` / `settings.set` | chave/valor |
| `dialog.pickFolder` | → caminho |

---

## 4. Modelo de dados

```sql
courses        (id, title, description, root_path, structure, numbering,
                cover_path, created_at, updated_at, last_opened_at)
modules        (id, course_id, parent_id NULL, title, rel_path, position)
lessons        (id, course_id, module_id, title, rel_path, kind,      -- video|text|pdf
                duration_sec, position, file_size, mtime)
lesson_assets  (id, lesson_id, kind, rel_path, lang NULL)              -- subtitle|attachment
lesson_progress(lesson_id PK, position_sec, duration_sec, completed_at,
                favorite, last_watched_at)
notes          (id, lesson_id, timestamp_sec NULL, body_md, created_at, updated_at)
study_sessions (id, lesson_id, started_at, ended_at, seconds)          -- tempo de hoje e streak
settings       (key PK, value_json)
```

- Os caminhos são **relativos à `root_path`**. Se o usuário mover a pasta, basta reapontar a raiz.
- A **revalidação** compara `rel_path + file_size + mtime` para saber o que foi adicionado, removido ou alterado, preservando o progresso e as anotações das aulas que continuam existindo.
- O **streak** é calculado a partir de `study_sessions`: um dia conta quando tem 60 s ou mais de estudo.

---

## 5. Scanner de pastas

**Estruturas suportadas:** `auto` (padrão) · `modules>lessons` · `modules>submodules>lessons` · `flat` (arquivos na raiz).

**Regras:**
1. **Vídeo:** `.mp4 .m4v .webm .mkv .mov`. **Texto:** `.md .html .txt`. **Anexo:** `.pdf .zip .docx .pptx .xlsx` etc.
2. **Legenda:** `.vtt`/`.srt` com o mesmo nome-base do vídeo, e o sufixo de idioma vira `lang` (`aula.pt.srt`). O `.srt` é convertido para VTT na hora de servir.
3. **Ordenação natural** (`2` vem antes de `10`). O padrão de numeração `1. Nome`, `1 - Nome` ou sem número define como o prefixo é removido do título exibido.
4. No modo `auto`, a profundidade é deduzida pelo nível em que aparecem os vídeos: 0 é flat, 1 é módulos e 2 é submódulos.
4b. **Pastas-aula** (só no `auto`): se uma pasta tem 2 ou mais subpastas e todas têm exatamente um vídeo e nenhuma subpasta, cada subpasta vira uma aula (título = nome da pasta, demais arquivos = anexos). Submódulos de uma aula só ficam idênticos a isso; nesse caso o usuário escolhe "Módulos > Submódulos" na prévia.
4c. Subpastas além da profundidade escolhida são achatadas no nível acima, com aviso.
5. A duração vem dos metadados do vídeo, lidos no renderer com um `<video>` oculto em lote após o import, sem precisar de FFmpeg no MVP.
6. Arquivos ocultos e lixo do sistema (`.DS_Store`, `Thumbs.db`, `desktop.ini`) são ignorados.
7. **Avisos da prévia:** pasta vazia, vídeo em formato possivelmente incompatível (HEVC/H.265) e caminhos muito longos no Windows.

**Codecs:** o Chromium toca H.264, VP8/VP9, AV1, AAC, Opus e MP3. Um arquivo que não toca mostra o
aviso *"formato não suportado"* no player. A conversão com FFmpeg entra num objetivo futuro.

---

## 6. UI/UX simples

### Princípios
- **Uma ação principal por tela**: no Início é "Continuar", em Meus Cursos é "Importar" e no Player é "Assistir".
- **Barra lateral fixa** que pode ser recolhida para mostrar só os ícones.
- **Tema escuro por padrão**, com tema claro. Cores definidas por tokens CSS, com um único acento roxo.
- **Teclado primeiro**: `Espaço` (play/pause), `←/→` (±10 s), `N` (anotação), `Shift+N` (próxima aula), `F` (tela cheia), `[ ]` (velocidade).
- Estados vazios que **ensinam o próximo passo** (por exemplo, sem cursos aparece o botão "Importar seu primeiro curso").

### Mapa de telas
```
Sidebar ─┬─ Início             /
         ├─ Meus Cursos        /courses ──► Detalhes /courses/:id ──► Player /lesson/:id
         └─ Configurações      /settings
          (as abas futuras entram aqui, desabilitadas com "em breve")
```

### Wireframes

**Início**
```
┌────────┬──────────────────────────────────────────────────────┐
│ ◆ Tram │  Boa tarde 👋                         🔥 5 dias      │
│        │  sábado, 10 de outubro                                │
│ ⌂ Iní  │  Hoje: 42 / 60 min  ███████████████░░░░░              │
│ ▤ Curs │ ┌──────────────────────────────────────────────────┐ │
│        │ │ ▶  CONTINUAR ASSISTINDO                           │ │
│        │ │    Módulo 3 · Aula 12 — Fundamentos de Cálculo    │ │
│        │ │    ━━━━━━━━━━━━━━░░░░░░ 12:04 / 31:20  [Continuar]│ │
│        │ └──────────────────────────────────────────────────┘ │
│        │  Seus cursos                                          │
│ ⚙ Conf │  [Curso A 63%] [Curso B 21%] [Curso C 0%] [+ Importar]│
└────────┴──────────────────────────────────────────────────────┘
```

**Meus Cursos**
```
┌──────────────────────────────────────────────────────────────┐
│ Meus Cursos                       [🔍 buscar…] [Recentes ▾]  │
│                                              [+ Importar]    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│ │  capa    │ │  capa    │ │  capa    │                       │
│ │ Cálculo I│ │ Física   │ │ Python   │                       │
│ │ 24h · 63%│ │ 12h · 21%│ │ 8h · 0%  │                       │
│ │[Continuar]⋮│[Continuar]⋮│[Começar] ⋮│  ⋮ = editar/revalidar/excluir
│ └──────────┘ └──────────┘ └──────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

**Modal: Importar curso**
```
┌─ Importar curso ─────────────────────────────────────────────┐
│ Pasta:  /home/…/Cursos/Calculo-I            [Escolher pasta] │
│ Título: [Cálculo I                        ]                  │
│ Estrutura: (•) Auto ( ) Módulos>Aulas ( ) Módulos>Sub>Aulas  │
│            ( ) Arquivos na raiz                              │
│ Numeração: (•) "1. Nome" ( ) "1 - Nome" ( ) Sem número       │
│ ── Prévia ────────────────────────────────────────────────── │
│ ▾ 01 Limites (8 aulas)                                       │
│ ▾ 02 Derivadas (12 aulas)    ⚠ 1 vídeo pode não tocar (HEVC) │
│ 3 módulos · 31 aulas · 4 legendas · 6 anexos                 │
│                                   [Cancelar] [Importar]      │
└──────────────────────────────────────────────────────────────┘
```

**Detalhes do curso**
```
┌──────────────────────────────────────────────────────────────┐
│ ← Cálculo I                       63% ━━━━━━━━━━░░░  [▶ Cont.]│
│ 3 módulos · 31 aulas · 24h12                 [Expandir tudo] │
│ ▾ 01 Limites                                   8/8 ✓         │
│     ✓ 1. Introdução                          12:30           │
│     ✓ 2. Limites laterais                    18:02           │
│ ▾ 02 Derivadas                                 4/12          │
│     ◐ 5. Regra da cadeia                     22:10  ★        │
│     ○ 6. Derivada implícita                  15:44           │
└──────────────────────────────────────────────────────────────┘
```

**Player**
```
┌───────────────────────────────────────────┬──────────────────┐
│                                           │ Cálculo I        │
│               [ vídeo ]                   │ ▾ 02 Derivadas   │
│                                           │  ✓ 4. Produto    │
│ ━━━━━━━━━━━━━━░░░░░░░░  12:04 / 31:20     │  ▶ 5. Cadeia     │
│ ▶  ⏭   1.5×  CC  ⛶                        │  ○ 6. Implícita  │
├───────────────────────────────────────────┤                  │
│ Aula 5 · Regra da cadeia        ★  [✓ Concluir]              │
│ [Descrição] [Anotações (3)] [Anexos (2)]  │                  │
│  08:15  f(g(x))' = f'(g(x))·g'(x)   ✎ 🗑  │                  │
│  [+ Anotar em 12:04  (N)]                 │                  │
└───────────────────────────────────────────┴──────────────────┘
```

---

## 7. Estrutura do repositório

```
Tramotak/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/
│  │  ├─ index.ts            # janela, ciclo de vida
│  │  ├─ db/ (database.ts, migrations.ts, courses.ts)
│  │  ├─ scanner/ (scan.ts, files.ts, titles.ts, naturalSort.ts, subtitles.ts)
│  │  ├─ protocol/media.ts   # tramotak-media:// com Range
│  │  └─ ipc/ (courses.ts, lessons.ts, notes.ts, dashboard.ts, settings.ts)
│  ├─ preload/index.ts       # contextBridge → window.api (tipado)
│  ├─ shared/types.ts        # contratos IPC compartilhados
│  └─ renderer/
│     ├─ main.tsx, App.tsx, routes/
│     ├─ components/ (Sidebar, CourseCard, LessonTree, VideoPlayer, NotesPanel, ImportDialog)
│     └─ styles/tokens.css
├─ tests/ (unit/, e2e/)
└─ docs/PLANO-MVP.md
```

---

## 8. Marcos e critérios de aceite

| # | Marco | Pronto quando… |
|---|---|---|
| **M0** | Setup | `npm run dev` abre a janela com a sidebar; lint, Vitest e CI rodando nos 3 sistemas |
| **M1** | Banco + scanner | Testes do scanner passam para as 4 estruturas, ordenação natural, legendas e arquivos ignorados |
| **M2** | Importar + Meus Cursos | O usuário escolhe a pasta, vê a prévia, importa e o cartão aparece; editar, excluir e revalidar funcionam |
| **M3** | Detalhes + Player | O vídeo toca pelo protocolo com seek; posição salva e retomada; velocidade, legendas, concluir, favorito e próxima aula |
| **M4** | Anotações | `N` cria nota no tempo atual; clicar na nota pula o vídeo; editar e excluir |
| **M5** | Início + Configurações | Continuar assistindo, minutos de hoje × meta, streak; troca de tema e meta |
| **M6** | Empacotamento | Tag `v0.1.0` gera `.exe`, `.dmg` e `.AppImage` instaláveis; teste e2e do fluxo importar → assistir → anotar |

---

## 9. Roadmap dos próximos objetivos

2. ✅ **Busca global** (Ctrl+K) sobre cursos, módulos, aulas e anotações (SQLite FTS5)
   - Índice `search_index` (migration 3) com `unicode61 remove_diacritics 2`: ignora acentos e maiúsculas.
     `rowid = id × 8 + tipo` (1 curso, 2 módulo, 3 aula, 4 anotação); *triggers* mantêm o índice em dia,
     inclusive nas exclusões em cascata e na revalidação; a migration indexa os dados já existentes.
   - Cada palavra digitada vira um prefixo obrigatório (`calc deriv` → `"calc"* "deriv"*`); operadores e
     pontuação são descartados. Ordenação por `bm25`, com peso 4 no título.
   - Paleta com resultados agrupados, trechos destacados, setas/Enter/Esc e buscas recentes.
     Anotações abrem a aula no horário delas (`/lesson/:id?t=segundos`).
3. ✅ **Flashcards** com repetição espaçada (SM-2), cartas a partir de anotações, import `.apkg`/`.txt`
   - Agendador puro em `src/shared/srs.ts`: etapas 1 e 10 min, graduação 1 dia, Fácil 4 dias, facilidade 2,5
     (mín. 1,3), bônus Fácil 1,3, Difícil 1,2×, lapso → reaprendizado de 10 min e volta com 1 dia; variação
     aleatória em intervalos longos; o atraso conta como no Anki. Vencimento à meia-noite local.
   - Migration 4: `decks`, `cards` (estado SM-2 na própria carta), `reviews` (histórico). Cartas na busca (tipo 5).
   - Fila na ordem do Anki: aprendizado vencido → revisões de hoje → novas → aprendizado adiantado (20 min).
     Limites diários por baralho: 20 novas e 200 revisões.
   - Carta criada de uma anotação guarda aula e horário; "Ver na aula" volta ao ponto do vídeo.
   - Tempo de resposta (até 60 s por carta) soma na meta diária e na sequência.
   - Importação: `.apkg` antigo (`collection.anki2`) e novo (`collection.anki21b`, zstd), com HTML convertido
     em texto e cloze virando pergunta/resposta; `.txt`/`.tsv` (Anki) ou `frente;verso`. Entra como cartas
     novas (o agendamento do Anki não é importado). Leitor de ZIP próprio, sem dependências.
   - Fica para depois: FSRS, opções por baralho, mídia (imagem/áudio) nas cartas, desfazer resposta.
4. ✅ **Planner + Progresso** (calendário, kanban, heatmap, metas)
   - Migration 5: `tasks` (status/posição do kanban, data e horário locais, duração, prazo, curso/aula, avisado em).
   - Kanban com arrastar e soltar (reordena a coluna inteira; concluir registra a data) e adição rápida.
   - Calendário mensal (domingo a sábado) com tarefas, prazos e revisões de flashcards previstas por dia
     (vencidas contam hoje); painel do dia ao lado; duplo clique cria tarefa na data.
   - Painel "Hoje" no Início: agendadas para hoje e prazos vencidos, concluídas com um clique.
   - Notificações do sistema: aviso de bloco com horário (na hora / 5 / 10 / 15 min antes, só uma vez por
     agendamento) e resumo do dia a partir das 8h; clique abre o Planner. Configurável.
   - Progresso: totais, sequência, mapa de atividade de 53 semanas (intensidade pela meta), colunas dos
     últimos 30 dias com a linha da meta, progresso por curso, estados e acerto dos flashcards (30 dias) e
     histórico de aulas assistidas com filtro por curso, texto sem acento e período.
   - `transaction()` passou a aceitar aninhamento (SAVEPOINT).
   - Fica para depois: curva de esquecimento por baralho, tarefas recorrentes.
5. ✅ **Questões e simulados** (bancos, sorteio por critérios, cronômetro)
   - Tipos: múltipla escolha, múltipla resposta (tudo ou nada), verdadeiro/falso, resposta curta (várias
     aceitas, sem acento/maiúsculas) e dissertativa (corrigida pela pessoa depois do envio). LaTeX via KaTeX
     (`$...$`, `$$...$$`, com `trust: false`). Correção pura em `src/shared/questions.ts`.
   - Migration 6: `question_banks`, `questions`, `exams`, `attempts` (com cópia das questões: editar ou
     excluir depois não muda notas antigas), `attempt_answers`. Questões na busca (tipo 6).
   - Simulado: sorteio por tópicos/dificuldades ou escolha manual; tempo limite, nota de corte, embaralhar
     questões/alternativas, permitir voltar, correção ao enviar ou a cada questão (que trava a questão).
   - O tempo é validado no processo principal (folga de 5 s); ao estourar, a prova fecha sozinha e conta só
     até o limite. Gabarito e explicação não saem do processo principal antes da hora.
   - Sessão: mapa de questões, marcar para revisar, salvamento automático, confirmação de envio com
     pendências, anti-cola (sair da janela avisa e registra), retomada de prova interrompida.
   - Desempenho: notas por tentativa, acerto por tópico, questões mais erradas, histórico de tentativas.
   - Importar/exportar: JSON (sem perdas), CSV (nomes de tipo em português, gabarito por letra/texto/V-F) e
     GIFT do Moodle (múltipla escolha, múltipla resposta com %, V/F, curta, dissertativa, $CATEGORY, ####).
     No GIFT, o bloco de respostas é o último grupo de chaves (o LaTeX usa chaves) e `\n` só vira quebra de
     linha fora das fórmulas.
   - Fica para depois: correspondência, ordenação, lacunas, hotspot, imagens, histórico de versões, PDF,
     simulados dentro do curso (com bloqueio por nota) e crédito parcial.
6. ✅ **Cadernos e mapas mentais**
   - Migration 7: `notebooks`, `notebook_pages` (blocos em JSON + texto para busca) e `mindmaps`. Páginas e
     mapas na busca global (tipos 7 e 0).
   - Cadernos: páginas ordenadas; blocos de texto (Markdown + LaTeX; `marked` → DOMPurify → KaTeX), desenho à
     mão (pressão da caneta, 6 cores, 3 espessuras, borracha, papel sempre claro) e recurso (curso, aula,
     baralho, banco). Salvamento automático com indicador; modo leitura contínua; PDF via `printToPDF` numa
     janela oculta sem JavaScript, com fórmulas em MathML.
   - Mapas mentais: núcleo puro em `src/shared/mindmap.ts` (árvore imutável, layouts árvore/organograma/
     radial sem sobreposição, validação contra ciclos). Editor SVG: Tab/Enter/F2/setas/Espaço/Delete, digitar
     para renomear, arrastar ramos, pan e zoom no cursor, cores, anexos (aula, curso, link), desfazer/refazer,
     reorganização automática a cada mudança de estrutura, PNG (2×) e JSON, importação de JSON.
   - Fica para depois: texto livre, caneta e grupos no mapa, minimapa, mini-player de vídeo no nó, imagens
     nos cadernos.
7. ✅ **FFmpeg**: conversão de vídeos incompatíveis + transcrição (Whisper)
   - FFmpeg embutido (`ffmpeg-static` 5.3, FFmpeg 7.0, GPL, programa separado com aviso de licença no app;
     +30 MB no instalador). Fica fora do asar (`asarUnpack`). Sem ffprobe: os codecs vêm do `ffmpeg -i`.
   - Plano por vídeo, do mais barato ao mais caro: trocar contêiner (ex.: AVI com H.264), converter só o áudio
     (ex.: AC-3) ou recodificar (ex.: HEVC → H.264). Cópia em `<dados>/converted`; os arquivos do curso nunca
     são alterados; revalidar com o arquivo mudado descarta a cópia.
   - O Chromium não acusa erro em HEVC (toca só o áudio, imagem 0×0): o player confere o formato com o FFmpeg
     ao abrir a aula e oferece "Converter para tocar aqui"; reforço por imagem 0×0.
   - Fila no processo principal (uma tarefa por vez, progresso via `-progress`, cancelamento sem arquivo pela
     metade) com indicador na barra lateral; "Verificar formatos" converte um curso inteiro.
   - Transcrição: Groq (chave cifrada pelo `safeStorage`, nunca volta para a interface) ou Whisper local
     compatível com a API da OpenAI. Áudio mono 16 kHz 32 kb/s em pedaços de 10 min; trechos com horário
     contínuo. Migration 8: `transcripts`; o texto falado entra na busca da aula. Aba "Transcrição" no player
     (trecho atual destacado, clique pula, busca) e legenda "Transcrição automática".
   - CI do macOS gera o .dmg arm64, troca o FFmpeg pelo de Intel e gera o .dmg x64.
   - Fica para depois: aceleração por GPU, transcrever o curso inteiro de uma vez, edição da transcrição,
     tradução, modo destrutivo (substituir o original).
8. ✅ **IA BYOK** (Claude, Gemini, Ollama) gerando cards e questões
   - Provedores sem SDK (só `fetch` no processo principal): Claude (Messages API), Gemini (`generateContent`
     com `responseMimeType` JSON), Ollama (`/api/chat`, `format: json`, contexto de 16k) e qualquer API
     compatível com a OpenAI (OpenAI, OpenRouter, LM Studio, vLLM; modo JSON só na API oficial). Chaves por
     provedor no `safeStorage`; a interface só sabe se existe chave. "Testar conexão" lista os modelos da conta.
   - Material montado no processo principal: texto da aula (md/html/txt), transcrição (ou, sem ela, a legenda
     do curso, limpa de horários e repetições), anexos de texto e anotações com horário; ou os blocos de texto
     de uma página de caderno; ou texto colado. Corte por provedor (150 mil caracteres na nuvem, 24 mil no
     Ollama) num fim de parágrafo, com aviso.
   - Saídas: flashcards, questões (múltipla escolha, múltipla resposta, V/F, curta), resumo em Markdown e mapa
     mental. Prompt pede só JSON; o material vai entre `<material>` e é tratado como conteúdo, não instrução.
     Leitura tolerante (blocos de código, texto em volta, gabarito por índice 0/1-based, letra ou texto) e
     validação pelas mesmas regras do resto do app (`validateQuestion`, `applyLayout`); o que vier
     malformado é descartado. Núcleo puro em `src/shared/ai.ts`.
   - Revisão antes de salvar: editar e desmarcar cartas (repetidas no baralho de destino são ignoradas),
     questões com gabarito destacado e LaTeX, resumo com prévia, mapa como estrutura. Destino existente ou novo;
     cartas ligadas à aula, resumo vira página de caderno com link para a aula, mapa nasce com a aula anexada.
   - Atalhos "Gerar com IA" no player, no baralho, no banco de questões e no caderno. Um pedido por vez,
     cancelável, com limite de 5 min.
   - Opções gratuitas em destaque, escolhidas por cartões com selo (Grátis / Login / Local / Pago / Avançado):
     - Gemini: passo a passo para criar a chave grátis no Google AI Studio com a conta pessoal (link aberto pelo
       processo principal, só para URLs conhecidas) e aviso de que o plano grátis pode usar o conteúdo. O login
       "Entrar com Google" do Gemini CLI é exclusivo dele; OAuth próprio cobraria a cota do projeto do app, não a
       da pessoa, por isso a chave do AI Studio.
     - OpenRouter: login OAuth com PKCE (servidor de retorno em 127.0.0.1/::1 numa porta livre, `state` contra
       CSRF, página só responde depois da troca pela chave, 5 min de limite, cancelável). Lista marca os modelos
       gratuitos (filtro "Só gratuitos"); padrão `openrouter/free`.
     - Ollama: detecta se está rodando (`/api/version`), link para baixar, lista de modelos leves (Llama 3.2
       1B/3B, Qwen 2.5 1.5B/3B, Qwen 3 4B, Gemma 3 4B) com instalação pelo app (`/api/pull` em NDJSON, barra de
       progresso, cancelar) e "Usar".
     - Claude: só chave do Claude Console. Desde fev/2026 a Anthropic proíbe e bloqueia no servidor o uso do login
       Free/Pro/Max em apps de terceiros; a tela explica e aponta o OpenRouter como alternativa.
   - Sem metadados: título da aula, curso, módulo e nomes de arquivos não vão para a IA (cabeçalhos neutros como
     "Transcrição automática da fala"). Por padrão só a fala/texto da aula; anexos e anotações são opcionais. As
     regras proíbem perguntas sobre a organização do curso ou sobre o próprio texto e avisam que a transcrição
     automática pode ter erros.
   - Sobre o assunto, não sobre o vídeo: o material só indica os temas; cada carta/questão precisa se sustentar
     sozinha para quem nunca viu o vídeo, e exemplos do vídeo viram conhecimento geral ou situações-problema
     novas. Rede de segurança `aboutTheMedium` descarta itens que falam do vídeo como acontecimento ("no vídeo",
     "o professor disse", "no minuto 5", "[12:34]", "segundo a aula") e a revisão mostra quantos saíram; resumo e
     mapa explicam o conteúdo, não as etapas do vídeo; quiz pedido na conversa segue a mesma regra.
   - Pesquisa na internet (opcional, guardada em `aiWebSearch`): Gemini com `google_search` (sem o modo JSON, que
     não combina), Claude com `web_search_20250305` (`max_uses` 3) e OpenRouter com o plugin `web` (cobra créditos).
     Só para conferir/complementar os temas da aula; fontes (http/https, sem repetir) aparecem na revisão.
   - Conversa sobre a aula (aba "Perguntar à IA" no player, aulas de vídeo e de texto): base é a transcrição (ou a
     legenda do curso) com marcas [m:ss] a cada ~30 s; respostas em tempo real (SSE no Claude/Gemini/OpenAI/
     OpenRouter, NDJSON no Ollama), horários citados viram botões que pulam o vídeo, momento atual do vídeo vai
     junto da pergunta ("explique este trecho"), fontes da internet, parar no meio (guarda o parcial), copiar e
     salvar a resposta como anotação. Migration 9: `ai_chats` (mensagens por aula, até 200; somem com a aula).
     Histórico enviado: últimas 16 mensagens/24 mil caracteres. No Claude, as instruções com a transcrição ficam
     em cache entre perguntas.
   - Fica para depois: gerar do curso inteiro, PDFs como material, custo estimado por pedido, conversa sobre o
     curso todo.
9. ✅ **Exportar/Importar** pacotes e backup do banco
   - Backup: `VACUUM INTO` (cópia consistente com o banco aberto) num `.db`, sem as chaves de API (só decifram
     neste computador). Backup automático diário (1 min após abrir e a cada 6 h, se o último tiver > 20 h) em
     `<dados>/backups`, guardando os 7 mais recentes; manuais e "antes de restaurar" nunca são apagados.
   - Restaurar: confere cabeçalho SQLite, tabelas do Tramotak, `quick_check` e versão do esquema (recusa backup de
     versão mais nova), mostra o conteúdo e reinicia o app. A troca acontece no início, antes de abrir o banco:
     o atual vira `antes-de-restaurar-…`, o backup entra no lugar (migrations sobem a versão) e as chaves deste
     computador são mantidas. Pendência inválida é descartada. AppImage e `.exe` portátil rodam de uma cópia
     temporária e não se relançam com confiança (testado: o processo novo trava): nesses o app avisa e fecha, e a
     restauração acontece na próxima abertura.
   - "Trocar pasta…" no curso: aponta para a nova pasta e revalida casando as aulas pelo caminho relativo
     (progresso e anotações ficam). Recusa se menos da metade das aulas corresponder (pasta errada apagaria dados)
     ou se a pasta for de outro curso.
   - Pacotes `.tramotak` (JSON em gzip, `format: tramotak-package`, versão 1): baralhos (com ou sem agendamento),
     bancos com simulados, cadernos, mapas e, por curso, anotações, transcrições e progresso. Sem caminhos do disco:
     cursos viram chave + títulos + caminhos relativos das aulas; ligações de cartas, blocos de caderno e anexos de
     mapa viram `{curso, caminho}`. Na importação, cada curso do pacote é ligado a um curso local (sugestão por
     título ou ≥ 50% das aulas em comum); tudo entra como item novo numa transação, anotações não duplicam e o
     progresso mantém o mais recente/adiantado. Ligações sem destino são contadas e descartadas.
   - Fica para depois: incluir sessões de estudo e tarefas nos pacotes, backup para a nuvem, criptografia do
     backup com senha, exportar o curso com os vídeos.

10. ✅ **Aparência** (depois do roadmap)
   - Núcleo puro em `src/shared/appearance.ts`: temas Grafite (padrão), Meia-noite, Azul-marinho, Claro, Papel e
     "Sistema"; 8 cores de destaque com um tom para fundo escuro e outro para claro (azul do ícone é o padrão); o
     texto sobre o destaque (`--on-accent`) é branco ou quase preto pelo maior contraste. Testes garantem 4,5:1 do
     texto sobre o destaque e 3:1 do destaque sobre cada fundo, em todas as combinações.
   - Tamanho da interface muda a fonte da raiz (o Tailwind mede em rem); cantos trocam as variáveis `--radius-*`
     do Tailwind; fonte com serifa; "reduzir animações" zera transições (spinners continuam).
   - Estilos prontos (Tramotak, Foco, Noturno azul, Leitura, Claro) com miniaturas desenhadas nas próprias cores;
     ajuste fino depois e "voltar ao padrão". Guardado por computador (localStorage), migrando a preferência
     antiga de claro/escuro. Mapa mental (nó central e PNG) segue a cor escolhida.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Vídeos em HEVC/MKV que não tocam | Aviso na prévia e no player; FFmpeg no Objetivo 7 |
| Pastas enormes (milhares de arquivos) | Scanner assíncrono com progresso; inserts em transação |
| Caminhos longos no Windows | Aviso na prévia; caminhos relativos no banco |
| `node:sqlite` ainda é marcado como experimental no Node 22 | Funciona no Electron 44 (Node 24, SQLite 3.53); acesso isolado em `src/main/db/` para trocar de driver se preciso |
| Assinatura de código (SmartScreen/Gatekeeper) | Sem assinatura no MVP, com instruções no README; assinar antes do lançamento público |
