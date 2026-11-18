# Distribuição (rascunhos para o dono enviar)

O Tramotak não cria contas nem publica em lojas sozinho. Cada item abaixo precisa de um cadastro ou envio seu.

## 1. Assinatura do instalador do Windows (SignPath Foundation, grátis para código aberto)
1. Pedir em https://signpath.org/ (projeto com licença OSI: GPL-3.0-or-later vale).
2. Quando aprovado, criar o projeto no SignPath e pôr no repositório os segredos `SIGNPATH_API_TOKEN` e as variáveis
   `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` e `SIGNPATH_POLICY_SLUG`.
3. Ativar a etapa de assinatura em `.github/workflows/ci.yml` (job `package`, Windows): o rascunho está em
   `packaging/signpath-ci-snippet.yml`.

## 2. Flathub
- `packaging/flatpak/`: manifesto, `.desktop` e metainfo (id `io.github.gabrielwaltrich.Tramotak`).
- Trocar a URL e o `sha256` do `.deb` pela versão a publicar, testar com
  `flatpak-builder --user --install build packaging/flatpak/io.github.gabrielwaltrich.Tramotak.yml`
  e abrir o PR em https://github.com/flathub/flathub (ver o guia "Submission" do Flathub).
- Dentro do Flatpak, a atualização automática do app não deve rodar (o Flathub atualiza).

## 3. winget
`packaging/winget/gerar.sh 1.0.0` baixa o instalador da Release, calcula o SHA-256 e escreve os três manifestos.
Enviar como PR em https://github.com/microsoft/winget-pkgs.

## 4. GitHub Sponsors
`.github/FUNDING.yml` já aponta para a sua conta; falta ativar o Sponsors em github.com/sponsors.
