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
4. **Planner + Progresso** (calendário, kanban, heatmap, metas)
5. **Questões e simulados** (bancos, blueprints, cronômetro)
6. **Cadernos e mapas mentais**
7. **FFmpeg**: re-encode de vídeos incompatíveis + transcrição (Whisper)
8. **IA BYOK** (Claude, Gemini, Ollama) gerando cards e questões
9. **Exportar/Importar** pacotes e backup do banco

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Vídeos em HEVC/MKV que não tocam | Aviso na prévia e no player; FFmpeg no Objetivo 7 |
| Pastas enormes (milhares de arquivos) | Scanner assíncrono com progresso; inserts em transação |
| Caminhos longos no Windows | Aviso na prévia; caminhos relativos no banco |
| `node:sqlite` ainda é marcado como experimental no Node 22 | Funciona no Electron 44 (Node 24, SQLite 3.53); acesso isolado em `src/main/db/` para trocar de driver se preciso |
| Assinatura de código (SmartScreen/Gatekeeper) | Sem assinatura no MVP, com instruções no README; assinar antes do lançamento público |
