# Tramotak — Caminho até a 1.0.0

O plano original (MVP e Objetivos 1–9, mais aparência e nomes das aulas) está em [PLANO-MVP.md](PLANO-MVP.md).
Este documento é o roteiro seguinte: o que falta para a **1.0.0**. A 1.0 é sobre **confiança**: o app se atualiza
sozinho, abre sem aviso de segurança, aguenta cursos grandes (1.000+ aulas) e entrega IA útil mesmo sem conta paga.

Legenda: ✅ feito · 🚧 em andamento · ⬜ a fazer

---

## 0.5 — Atualizar, aguentar e transcrever ✅ (publicada: v0.5.0)
Inclui o que seria a 0.4.3 (não publicada separadamente):
- ✅ Durações medidas pelo FFmpeg no processo principal, em segundo plano (curso de 1.092 aulas em ~40 s).
- ✅ Regras de nomes por curso com prévia e sugestão opcional da IA.
- ✅ **Atualização automática** (`electron-updater` + Releases do GitHub): procura 15 s depois de abrir e a cada 6 h
  (desligável), baixa em segundo plano e instala ao reiniciar, reabrindo o app — instalador do Windows, AppImage e
  `.deb` (este pede a senha do sistema pelo `pkexec`). macOS sem assinatura e `.exe` portátil: avisa e leva à
  página da versão (consulta a API de Releases). Aviso discreto na barra superior. Testado com AppImage 0.5.0 →
  0.5.1 servido localmente (`TRAMOTAK_UPDATE_URL`): baixou, trocou o arquivo e reabriu na versão nova.
- ✅ **Desempenho com cursos grandes** medido com 1.092 aulas: lista de cursos 8 ms, detalhe 11 ms, busca 15 ms,
  página do curso 40 ms, player 134 ms (inclui carregar o vídeo), abertura ~2,3 s em desenvolvimento. Nada a corrigir.
- ✅ **Transcrição local embutida** (whisper.cpp v1.9.5, `scripts/build-whisper.sh`, compilado no CI para cada
  sistema; no macOS universal arm64+x64; portátil: sem `-march=native`, AVX2/FMA no x86, estático). Modelos baixados
  pelo app do repositório oficial no Hugging Face, conferidos por tamanho e SHA-256: Rápido (base q5_1, 57 MB),
  Equilibrado (small q5_1, 181 MB) e Preciso (large-v3-turbo q5_0, 547 MB). Áudio extraído pelo FFmpeg (16 kHz
  mono), progresso pelo `-pp`, cancelável. Testado: 11 s de fala em 6 s com o modelo Rápido.
- ✅ **Transcrever o curso inteiro**: botão no curso, fila com as aulas sem transcrição, indicador resumido
  ("+N na fila"), cancelar tudo e repetir as que falharam (ex.: limite diário do Groq).

## 0.6 — Plano de estudos e FSRS ✅ (publicada: v0.6.0)
- ✅ **Plano de estudos por curso** (migration 11: `study_plans`, `tasks.plan_id`, `plan_lessons`). Dois modos:
  terminar até uma data (divide o tempo igualmente pelos dias de estudo, sem quebrar a ordem das aulas) ou minutos
  por dia (enche cada dia com 10% de folga). Dias da semana, velocidade dos vídeos e dia de início; vídeos sem
  duração entram pela duração típica do curso e textos como 10 min. Prévia antes de salvar (aulas, tempo por dia,
  término, aviso acima de 4 h/dia, minutos já pedidos por outros planos).
- ✅ Cada dia vira uma tarefa no Planner com as aulas do dia; ela se conclui sozinha quando todas as aulas forem
  concluídas (inclusive adiantadas). No quadro, os dias futuros ficam só no Calendário. Cartão do plano no curso e
  no Planner: hoje, término, aulas atrasadas ou fora do plano e a previsão pelo ritmo real dos últimos 14 dias.
- ✅ **Replanejamento**: botão e automático (ao abrir o app e na virada do dia) quando sobram aulas de dias que
  passaram; no modo data-alvo mantém a data, no modo ritmo empurra o fim. Dias concluídos ficam como histórico.
  Testado com o curso real de 1.092 aulas (79 dias, ~2 h/dia até a meta; atraso simulado replanejado na abertura).
- ✅ **FSRS-6 no lugar do SM-2** (`src/shared/srs.ts`), com os parâmetros padrão do Anki e conferido contra o
  ts-fsrs (só nos testes). Memória (estabilidade e dificuldade) calculada ao abrir o app refazendo o histórico de
  respostas; cartas sem histórico (pacotes, Anki) aproximadas pelo intervalo e pela facilidade. Datas já marcadas
  não mudam.
- ✅ **Opções por baralho**: retenção desejada (70–97%), novas e revisões por dia, etapas de aprendizado e de
  reaprendizado, intervalo máximo. Pacotes `.tramotak` levam as opções e a memória das cartas.
- ✅ **macOS descontinuado**: a partir da 0.6.0 só há instaladores para Windows e Linux (a 0.5.0 foi a última
  para Mac). CI, empacotamento e `scripts/build-whisper.sh` sem o macOS.
- Fica para depois: otimizar os parâmetros do FSRS com o histórico da pessoa e reagendar as cartas ao mudar a
  retenção (hoje a mudança vale a partir da próxima resposta).

## 0.6.1 — Anotações reunidas ✅ (publicada: v0.6.1)
- ✅ **Página "Anotações"** (barra lateral): todas as anotações dos cursos num lugar só, agrupadas por curso,
  módulo e aula (ou as mais recentes primeiro), com busca, filtro por curso, horário que abre o vídeo no ponto,
  edição, exclusão e flashcard. Exportar em Markdown (`.md`).
- ✅ **Enviar anotações para um caderno** (da página ou do player, uma nota ou a aula inteira): caderno novo ou
  existente, página nova ou no fim de uma página. Cada aula vira um atalho para o vídeo, seguido das notas com
  os horários como links que abrem o vídeo no ponto certo (links internos `#/lesson/…` passam a funcionar nos
  cadernos). O texto continua editável.

## 0.6.2 — Janela flutuante ✅ (publicada: v0.6.2)
- ✅ **Janela flutuante (picture-in-picture)** do player: sempre por cima, transparência ajustável (opaca com o
  mouse em cima), tocar/pausar, voltar/avançar (5–30 s), volume, legenda, velocidade, aula anterior/próxima,
  voltar ao app e fechar; arrastar para mover, cantos para redimensionar em 16:9, posição lembrada; atalhos de
  teclado. Progresso, tempo de estudo, conclusão e próxima aula gravados pelo processo principal
  (`src/main/pip/host.ts`), com o player do app sincronizado. Opções em Configurações → Janela flutuante.
- ✅ **Linux com Wayland**: a janela roda num processo separado em X11 (XWayland), porque o GNOME não deixa
  janelas de apps ficarem por cima; o app continua em Wayland. Sem XWayland, cai para janela comum com aviso.

## 0.6.3 — Revisão pós-aula ✅ (publicada: v0.6.3)
- ✅ Primeira parte da 0.7, publicada antes: perguntas rápidas ao concluir a aula (detalhes no item da 0.7).

## 0.7 — PDFs e revisão pós-aula ⬜
- ✅ PDFs como aula: leitura, grifo e anotações dentro do app (aulas e anexos PDF); texto do PDF como material da
  IA; conclui ao chegar na última página.
- ✅ Revisão pós-aula: ao concluir, 3 a 5 perguntas rápidas sobre o assunto (múltipla escolha e V/F, correção na
  hora, erradas viram flashcard; sem transcrição, transcreve antes). Perguntas salvas por aula.
- Pomodoro/modo foco integrado ao tempo de estudo.

## 0.8 — IA no curso inteiro ⬜
- Conversa sobre o curso todo (busca nas transcrições de todas as aulas, citando aula e minuto).
- Gerar baralho/banco de questões do curso inteiro.
- Tutor dos pontos fracos (a partir dos erros em simulados e flashcards) e "explique meu erro".
- Custo estimado antes de gerar nos provedores pagos.

## 0.9 — Polimento e beta ⬜
- Primeira execução guiada e curso de exemplo.
- "Relatar problema": arquivo de diagnóstico sem dados pessoais.
- Acessibilidade (teclado, leitor de tela, contraste) revisada tela a tela.
- Backup automático para uma pasta escolhida (Drive/Dropbox) como sincronização simples.
- Beta com usuários em Windows e Linux reais.

## 1.0.0 ⬜
- Instalador do Windows assinado (certificado de código).
- Correções do beta; documentação de uso.

---

## Fora da 1.0 (ideias para depois)
Sincronização com servidor, app de celular, marcadores e capítulos no vídeo, mini-player, novos tipos de questão
(lacunas, ordenação, correspondência), imagens em cartas e cadernos.
