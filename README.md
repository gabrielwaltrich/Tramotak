# Tramotak

Central de estudos desktop: importe cursos que já estão no seu computador e estude com eles.
Windows, macOS e Linux.

- **Biblioteca:** importe a pasta de um curso; módulos, aulas, legendas e anexos são detectados sozinhos.
- **Nomes das aulas:** regras por curso para limpar títulos vindos de nomes de arquivo (código como `#F0009` vira `9`, datas, numeração interna, autor depois do `@`, emojis, `_`, sufixos de cópia, textos e trocas personalizados), com prévia de todas as aulas e sugestão opcional da IA. Os arquivos não são renomeados.
- **Player:** retoma de onde parou, velocidade de 0,25× a 2×, legendas `.srt`/`.vtt`, próxima aula automática e atalhos de teclado; converte vídeos que não tocam (ex.: HEVC) e transcreve aulas, com o texto falado pesquisável.
- **Anotações:** aperte `N` durante a aula para anotar no ponto exato do vídeo; clique no horário para voltar a ele.
- **Busca global:** barra de pesquisa no topo (ou `Ctrl+K` em qualquer tela) encontra cursos, aulas, anotações e flashcards, sem se importar com acentos.
- **Flashcards:** repetição espaçada no estilo do Anki (SM-2); transforme anotações em cartas ligadas ao ponto da aula; importe baralhos `.apkg` do Anki.
- **Questões e simulados:** bancos com 5 tipos de questão e fórmulas LaTeX, simulados cronometrados com anti-cola, correção e desempenho por tópico; importa e exporta JSON, CSV e GIFT (Moodle).
- **Cadernos:** páginas com Markdown, fórmulas, desenho à mão (caneta com pressão) e links para o seu material; exporta PDF.
- **Mapas mentais:** editor por teclado com layouts automáticos (árvore, organograma, radial), cores e anexos; exporta PNG e JSON.
- **IA (dá para usar de graça):** converse com a IA sobre a aula (as respostas citam o momento do vídeo, com clique para pular até ele) e gere flashcards, questões, resumos e mapas mentais a partir do que é falado na aula, revise e salve. A IA usa só o conteúdo, nunca título, curso ou nomes de arquivos; a pesquisa na internet é opcional. Gemini grátis com a conta Google, login no OpenRouter (modelos grátis e pagos), modelos leves no seu computador pelo Ollama (Llama, Qwen, Gemma), chave do Claude ou qualquer API compatível com a OpenAI.
- **Planner:** tarefas em quadro (arrastar e soltar) e calendário com as revisões previstas; avisos antes dos blocos de estudo.
- **Progresso:** mapa de atividade, minutos dos últimos 30 dias contra a meta, progresso por curso e histórico.
- **Backup e pacotes:** backup completo do banco (manual e automático diário) com restauração; pacotes `.tramotak` para levar baralhos, questões, cadernos, mapas e anotações a outro computador ou pessoa.
- **Aparência:** estilos prontos (Tramotak, Foco, Noturno azul, Leitura, Claro) e ajustes de tema (Grafite, Meia-noite, Azul-marinho, Claro, Papel ou o do sistema), 8 cores de destaque, tamanho da interface, cantos, fonte com serifa para leitura e animações reduzidas.
- **Início:** continuar assistindo, tarefas e flashcards do dia, meta diária de minutos e sequência de dias de estudo.

Tudo fica no seu computador (exceto o que você mandar transcrever ou gerar com um provedor na nuvem): o Tramotak lê as pastas dos cursos sem alterá-las e guarda progresso e anotações num banco local.

Plano original: [docs/PLANO-MVP.md](docs/PLANO-MVP.md). Caminho até a 1.0: [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md).

## Instalação

Baixe a versão mais recente em **[Releases](https://github.com/gabrielwaltrich/Tramotak/releases/latest)**. Cada versão traz os instaladores e um `SHA256SUMS.txt` para conferir os arquivos.

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows | `Tramotak-x.y.z-setup.exe` ou `-portable.exe` | O app ainda não é assinado: no aviso do SmartScreen, clique em **Mais informações → Executar assim mesmo**. |
| macOS | `Tramotak-x.y.z-arm64.dmg` (Apple Silicon) ou `-x64.dmg` (Intel) | Não assinado: na primeira vez, clique com o botão direito no app → **Abrir**. Se o macOS bloquear, vá em **Ajustes do Sistema → Privacidade e Segurança → Abrir Assim Mesmo**. |
| Linux | `Tramotak-x.y.z-linux-x86_64.AppImage` ou `-amd64.deb` | AppImage: dê permissão de execução (`chmod +x`). No Ubuntu 24.04+, se não abrir, veja a nota abaixo. |

**Ubuntu 24.04+ e AppImage:** a proteção AppArmor pode impedir o sandbox do Chromium. Prefira o `.deb`, ou rode o AppImage com `--no-sandbox`.

**Formatos de vídeo:** o player toca o que o Chromium suporta (H.264, VP8/VP9, AV1 em `.mp4`/`.webm`/`.mkv`). Vídeos em HEVC/H.265, `.avi`, `.wmv` e afins são detectados e podem ser convertidos pelo FFmpeg embutido, em uma cópia na pasta do app (os arquivos do curso não são alterados).

**Transcrição:** opcional, em Configurações → Vídeo e transcrição. **No computador (grátis):** o Whisper vem embutido; baixe um modelo pelo app (57 MB a 547 MB) e transcreva sem internet nem chave. Também dá para usar o Groq (nuvem, com a sua chave) ou um servidor Whisper compatível com a API da OpenAI. Dá para transcrever o curso inteiro de uma vez (botão "Transcrever curso").

**Atualizações:** o Tramotak procura versões novas nas Releases do GitHub e, no instalador do Windows, no AppImage e no `.deb`, baixa e instala sozinho ao reiniciar (o `.deb` pede a senha do sistema). No macOS e no `.exe` portátil ele avisa e leva à página da versão. Dá para desligar em Configurações → Atualizações.

**IA:** opcional, em Configurações → Inteligência artificial. O material só é enviado quando você clica em gerar, e tudo passa pela sua revisão antes de virar carta ou questão. Para gerar de um vídeo, transcreva a aula antes (ou use a legenda que veio com o curso).

| Opção | Custo | Como conectar |
|---|---|---|
| Gemini (Google) | Grátis, com limite de pedidos por dia | Crie uma chave no [Google AI Studio](https://aistudio.google.com/apikey) com a sua conta Google pessoal e cole no app. No plano grátis o Google pode usar o conteúdo para melhorar os produtos dele. |
| OpenRouter | Modelos `:free` grátis; pagos com créditos | Botão **Entrar com OpenRouter** (login no navegador). `openrouter/free` escolhe um modelo gratuito sozinho; também dá acesso a Claude, GPT e outros. |
| Ollama (local) | Grátis, offline | Instale o [Ollama](https://ollama.com/download) e baixe um modelo leve pelo próprio app (Llama 3.2, Qwen 2.5/3, Gemma 3). Nada sai do computador. |
| Claude (Anthropic) | Pago por uso | Chave do [Claude Console](https://console.anthropic.com/settings/keys). A assinatura Claude Pro/Max não funciona em outros apps (regra da Anthropic). |
| Compatível com OpenAI | Depende do servidor | OpenAI, LM Studio, vLLM… com endereço e chave. |

As chaves ficam cifradas pelo cofre do sistema e nunca voltam para a interface.

**Backup e outro computador:** em Configurações → Dados e backup. O backup é um arquivo `.db` com tudo, menos os vídeos e as chaves de API. Para migrar, restaure o backup no computador novo e use **Trocar pasta…** no menu dos cursos que estiverem em outro caminho; o progresso e as anotações são mantidos. Para compartilhar só parte do material, use **Exportar pacote…**.

**Licenças:** o Tramotak inclui o FFmpeg (GPL) e o whisper.cpp (MIT) como programas separados; a licença do FFmpeg está em Configurações → Sobre e a do whisper.cpp junto do programa (`resources/whisper`).

## Desenvolvimento

Requer Node.js 22.12 ou superior.

```bash
npm install
npm run dev        # abre o app com hot reload
npm run lint
npm run typecheck
npm test           # testes unitários (Vitest)
npm run test:e2e   # compila e roda o fluxo completo no app real (Playwright)
npm run dist:linux # gera instaladores em dist/ (também dist:win e dist:mac)
```

Para publicar uma versão: atualize `version` no `package.json`, escreva as notas em `docs/releases/vX.Y.Z.md`, faça commit e crie a tag (`git tag vX.Y.Z && git push --tags`). O CI roda lint, testes e E2E nos 3 sistemas, gera os instaladores e cria a Release no GitHub com eles e os checksums.

## Estrutura

```
src/main/       processo principal: banco (node:sqlite), scanner de pastas, protocolo de mídia, FFmpeg, IA, IPC
src/preload/    ponte segura main ↔ interface (window.api)
src/shared/     tipos e lógica compartilhados
src/renderer/   interface React
tests/unit/     testes Vitest
tests/e2e/      testes Playwright + curso de exemplo
resources/      ícone: arte original em icon-source.png; icon.png e icons/ gerados por scripts/prepare-icon.py
```
