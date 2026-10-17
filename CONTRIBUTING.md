# Como contribuir com o Tramotak

Obrigado pelo interesse! O Tramotak é um app de estudos **gratuito e de código aberto** (GPL-3.0) para cursos que
a pessoa já tem no computador. Toda ajuda conta: relatar um problema, sugerir uma ideia, melhorar um texto ou
mandar código.

A interface, a documentação, as issues e os commits são em **português do Brasil**.

## Relatar um problema

1. Confira se já não existe uma [issue](https://github.com/gabrielwaltrich/Tramotak/issues) sobre ele.
2. Abra uma issue com o formulário **Problema** e diga a versão do app (Configurações → Sobre), o sistema, como você
   instalou e os passos para repetir o problema.
3. **Nunca** cole chaves de API, senhas, caminhos com o seu nome ou conteúdo de cursos pagos.

Falhas de segurança não vão em issue pública: veja [SECURITY.md](SECURITY.md).

## Sugerir uma ideia

Abra uma issue com o formulário **Ideia** contando o problema que você quer resolver no seu estudo (mais do que a
solução). O caminho até a 1.0 está em [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md).

## Preparar o ambiente

Precisa do **Node 22** e do Git. No Linux, também das bibliotecas que o Electron usa (as mesmas de um navegador).

```bash
git clone https://github.com/gabrielwaltrich/Tramotak.git
cd Tramotak
npm ci
npm run dev
```

A transcrição embutida usa um `whisper-cli` compilado por `scripts/build-whisper.sh`; ele só é necessário para
testar a transcrição no computador ou para gerar os instaladores.

## Antes de mandar um pull request

```bash
npm run typecheck
npm run lint
npm test
npx electron-vite build && npx playwright test
```

Tudo precisa passar. Um recurso novo vem com testes unitários (Vitest, em `tests/unit/`) e, se mexe na interface,
com um passo no E2E (`tests/e2e/app.spec.ts`). Lógica que não depende do Electron vai em `src/shared/`, onde é fácil
de testar.

## Regras do projeto

- **Os arquivos dos cursos nunca são alterados.** O app só lê; conversões e cópias vão para a pasta de dados dele.
- **A IA usa só o conteúdo da aula** (fala, legenda, transcrição, texto, PDF) ou a internet. Nunca título da aula,
  nome do curso, nomes de arquivo ou outros metadados. Flashcards e questões são sobre o **assunto**, nunca sobre
  "o que aconteceu no vídeo".
- **Chaves de API** ficam cifradas pelo cofre do sistema e nunca voltam para a interface.
- **Nada de telemetria.** O app não manda dados para lugar nenhum sem a pessoa pedir.
- **Windows e Linux.** O macOS foi descontinuado na 0.6.0.
- Migrations publicadas não mudam: uma mudança no banco é sempre uma migration nova no fim.
- Siga o estilo do código vizinho; comentários em português explicam o porquê, não o quê.

## Licença das contribuições

Ao mandar uma contribuição, você concorda que ela seja distribuída sob a mesma licença do projeto, a
[GNU GPL versão 3 ou posterior](LICENSE). Não há contrato de cessão de direitos: o crédito continua seu no histórico
do Git.

## Convivência

Seja gentil e paciente. As regras estão no [código de conduta](CODE_OF_CONDUCT.md).
