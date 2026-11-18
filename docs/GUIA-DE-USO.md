# Guia de uso do Tramotak

Um passeio por todas as telas, na ordem da barra lateral. Para experimentar sem arriscar nada, use o curso de
exemplo **Como usar o Tramotak** (Configurações → Sobre → Ver a introdução de novo).

> O Tramotak **nunca altera os arquivos dos seus cursos**: só lê as pastas. Progresso, anotações e tudo o mais ficam
> num banco no seu computador.

## Atalhos que valem em qualquer tela
| Tecla | O que faz |
|---|---|
| `Ctrl+K` | Busca global (cursos, aulas, anotações, flashcards, questões, cadernos e mapas) |
| `N` | No player: anota no ponto exato do vídeo |
| `P` | No player: abre a janela flutuante |
| `Shift+N` | No player: próxima aula |
| `Esc` | Fecha janelas e painéis |

A interface toda funciona pelo teclado: `Tab` e `Shift+Tab` navegam, `Enter` e `Espaço` acionam botões.

## Início
Saudação, **Continuar assistindo**, tarefas e flashcards do dia, meta diária de minutos e sequência de dias de estudo.
Quem ainda não tem cursos vê os **Primeiros passos**.

## Cursos
- **Importar curso:** escolha a pasta; o app detecta módulos, aulas, legendas e anexos e mostra uma prévia antes de
  importar. Para mudar o jeito de ler a pasta, escolha a estrutura (módulos, módulos e submódulos, ou arquivos soltos).
- **Página do curso:** árvore de módulos e aulas com progresso, **Perguntar ao curso** (IA), **Transcrever curso**,
  **Criar plano de estudos**, regras de nomes das aulas e revalidar a pasta (acha aulas novas sem perder progresso).
- **Vídeos que não tocam** (HEVC, AVI…): o player avisa e oferece converter pelo FFmpeg embutido, numa cópia na pasta
  do app.

## Player
- Retoma de onde parou, velocidade de 0,25× a 2×, legendas `.srt`/`.vtt`, próxima aula automática (com contagem
  regressiva) e marcar como concluída ou favorita.
- **Anotações** com horário: `N` anota, e clicar no horário volta ao ponto. Um anexo ou texto também abre aqui.
- **PDF como aula:** leitor com páginas, zoom (`Ctrl`+roda), busca, grifos em 4 cores e anotações por página. A aula
  conclui ao chegar na última página.
- **Janela flutuante:** o vídeo numa janela pequena sempre por cima, com transparência ajustável.
- **Transcrição e IA:** transcreva a aula (Whisper no computador ou Groq) para ter legenda, busca e material para a IA.
- **Revisão rápida:** ao concluir, 3 a 5 perguntas sobre o assunto; as erradas viram flashcards.

## Anotações
Todas as anotações de todos os cursos, por curso, módulo e aula, com busca e filtro. Dá para editar, apagar,
transformar em flashcard, **exportar em Markdown** e **enviar para um caderno** (com os horários clicáveis).

## Flashcards
- Baralhos com repetição espaçada (**FSRS**, o algoritmo do Anki atual). Opções por baralho: retenção desejada,
  novas e revisões por dia, etapas de aprendizado e intervalo máximo.
- Estudo pelo teclado (`Espaço` mostra a resposta, `1` a `4` avaliam).
- **Importar** `.apkg` do Anki e **Exportar** para o Anki (`.apkg` com o agendamento, ou texto). Exportar de novo não
  duplica as cartas.

## Questões
Bancos de questões (5 tipos, com fórmulas LaTeX), **simulados** cronometrados com correção e desempenho por tópico.
Importa e exporta JSON, CSV e GIFT (Moodle).

## Cadernos
Páginas em Markdown com fórmulas, desenho à mão (caneta com pressão) e links para as suas aulas. Salvam sozinhos e
exportam em PDF.

## Mapas mentais
Editor pelo teclado com layouts automáticos (árvore, organograma, radial), cores e anexos. Exporta PNG e JSON.

## Planner
Quadro de tarefas (arrastar e soltar) e calendário com as revisões previstas. Os **planos de estudo** viram uma
tarefa por dia, com as aulas do dia; ao atrasar, o app **replaneja** (sozinho ou pelo botão). Avisos do sistema
antes dos blocos de estudo.

## Progresso
Mapa de atividade, minutos dos últimos 30 dias contra a meta, progresso por curso e histórico.

## IA
Opcional. Gere flashcards, questões, resumos e mapas mentais a partir do que é falado na aula (ou do texto do PDF),
ou do **curso inteiro** (N por aula, com teto). A IA usa só o conteúdo, nunca título, curso ou nomes de arquivo.
Revise e salve. Provedores: Gemini grátis, OpenRouter, Ollama no seu computador, Claude ou qualquer API compatível
com a OpenAI. Chaves ficam cifradas no seu computador.

## Pomodoro
Botão **Foco** na barra superior: blocos de foco e pausas (durações configuráveis). O bloco conta inteiro na meta
diária, sem repetir o que o app já mediu.

## Configurações
- **Aparência:** estilos prontos, temas (Grafite, Meia-noite, Azul-marinho, Claro, Papel ou o do sistema), 8 cores de
  destaque, tamanho da interface, cantos, fonte com serifa e animações reduzidas.
- **Dados e backup:** backup manual e automático, **cópia numa pasta sua** (Drive, Dropbox, pendrive: um por dia e
  um ao fechar, os 7 mais recentes) e restauração. Para levar tudo a outro computador, escolha a mesma pasta e use
  **Restaurar**.
- **Atualizações:** procura versões novas nas Releases do GitHub (desligável).
- **Sobre → Relatar problema:** diagnóstico sem dados pessoais para anexar ao pedido de ajuda no GitHub.

## Privacidade
Tudo fica no seu computador. Só sai algo se **você** pedir à IA ou à transcrição na nuvem, e só o conteúdo escolhido.
Não há telemetria, anúncios nem conta.

## Problemas comuns
- **O AppImage não abre no Ubuntu 24.04+:** use o `.deb` ou rode com `--no-sandbox`.
- **Aviso do SmartScreen no Windows:** o instalador ainda não é assinado. **Mais informações → Executar assim mesmo**.
- **Um vídeo não toca:** deve ser HEVC/AVI/WMV; use a conversão oferecida no player.
- **Algo quebrou:** Configurações → Sobre → Relatar problema.
