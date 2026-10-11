# Tramotak

Central de estudos desktop: importe cursos que já estão no seu computador e estude com eles.
Windows, macOS e Linux.

- **Biblioteca:** importe a pasta de um curso; módulos, aulas, legendas e anexos são detectados sozinhos.
- **Player:** retoma de onde parou, velocidade de 0,25× a 2×, legendas `.srt`/`.vtt`, próxima aula automática e atalhos de teclado; converte vídeos que não tocam (ex.: HEVC) e transcreve aulas, com o texto falado pesquisável.
- **Anotações:** aperte `N` durante a aula para anotar no ponto exato do vídeo; clique no horário para voltar a ele.
- **Busca global:** `Ctrl+K` em qualquer tela encontra cursos, aulas, anotações e flashcards, sem se importar com acentos.
- **Flashcards:** repetição espaçada no estilo do Anki (SM-2); transforme anotações em cartas ligadas ao ponto da aula; importe baralhos `.apkg` do Anki.
- **Questões e simulados:** bancos com 5 tipos de questão e fórmulas LaTeX, simulados cronometrados com anti-cola, correção e desempenho por tópico; importa e exporta JSON, CSV e GIFT (Moodle).
- **Cadernos:** páginas com Markdown, fórmulas, desenho à mão (caneta com pressão) e links para o seu material; exporta PDF.
- **Mapas mentais:** editor por teclado com layouts automáticos (árvore, organograma, radial), cores e anexos; exporta PNG e JSON.
- **Planner:** tarefas em quadro (arrastar e soltar) e calendário com as revisões previstas; avisos antes dos blocos de estudo.
- **Progresso:** mapa de atividade, minutos dos últimos 30 dias contra a meta, progresso por curso e histórico.
- **Início:** continuar assistindo, tarefas e flashcards do dia, meta diária de minutos e sequência de dias de estudo.

Tudo fica só no seu computador: o Tramotak lê as pastas dos cursos sem alterá-las e guarda progresso e anotações num banco local.

Plano e roadmap: [docs/PLANO-MVP.md](docs/PLANO-MVP.md).

## Instalação

Baixe a versão mais recente em **[Releases](https://github.com/gabrielwaltrich/Tramotak/releases/latest)**. Cada versão traz os instaladores e um `SHA256SUMS.txt` para conferir os arquivos.

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows | `Tramotak-x.y.z-setup.exe` ou `-portable.exe` | O app ainda não é assinado: no aviso do SmartScreen, clique em **Mais informações → Executar assim mesmo**. |
| macOS | `Tramotak-x.y.z-arm64.dmg` (Apple Silicon) ou `-x64.dmg` (Intel) | Não assinado: na primeira vez, clique com o botão direito no app → **Abrir**. Se o macOS bloquear, vá em **Ajustes do Sistema → Privacidade e Segurança → Abrir Assim Mesmo**. |
| Linux | `Tramotak-x.y.z-linux-x86_64.AppImage` ou `-amd64.deb` | AppImage: dê permissão de execução (`chmod +x`). No Ubuntu 24.04+, se não abrir, veja a nota abaixo. |

**Ubuntu 24.04+ e AppImage:** a proteção AppArmor pode impedir o sandbox do Chromium. Prefira o `.deb`, ou rode o AppImage com `--no-sandbox`.

**Formatos de vídeo:** o player toca o que o Chromium suporta (H.264, VP8/VP9, AV1 em `.mp4`/`.webm`/`.mkv`). Vídeos em HEVC/H.265, `.avi`, `.wmv` e afins são detectados e podem ser convertidos pelo FFmpeg embutido, em uma cópia na pasta do app (os arquivos do curso não são alterados).

**Transcrição:** opcional, em Configurações → Vídeo e transcrição. Use o Groq (nuvem, com a sua chave de API, guardada cifrada pelo sistema) ou um servidor Whisper local compatível com a API da OpenAI (ex.: faster-whisper, speaches). Sem configurar, nenhum áudio sai do computador.

**Licença do FFmpeg:** o Tramotak inclui o FFmpeg (GPL) como programa separado; a licença está em Configurações → Sobre.

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
src/main/       processo principal: banco (node:sqlite), scanner de pastas, protocolo de mídia, IPC
src/preload/    ponte segura main ↔ interface (window.api)
src/shared/     tipos e lógica compartilhados
src/renderer/   interface React
tests/unit/     testes Vitest
tests/e2e/      testes Playwright + curso de exemplo
resources/      ícone (gerado por scripts/make-icon.py)
```
