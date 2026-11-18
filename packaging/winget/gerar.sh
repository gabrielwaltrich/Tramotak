#!/usr/bin/env bash
# Gera os manifestos do winget (GabrielWaltrich.Tramotak) para uma versão já publicada na Release do GitHub.
# Uso: packaging/winget/gerar.sh 1.0.0   → cria packaging/winget/out/<versão>/*.yaml
# Depois, enviar a pasta como PR em github.com/microsoft/winget-pkgs (manifests/g/GabrielWaltrich/Tramotak/<versão>/).
set -euo pipefail
V="${1:?informe a versão, ex.: 1.0.0}"
URL="https://github.com/gabrielwaltrich/Tramotak/releases/download/v${V}/Tramotak-${V}-setup.exe"
SHA="$(curl -fsSL "$URL" | sha256sum | cut -d' ' -f1 | tr a-f A-F)"
OUT="$(dirname "$0")/out/${V}"; mkdir -p "$OUT"
ID=GabrielWaltrich.Tramotak
cat > "$OUT/$ID.yaml" <<Y
PackageIdentifier: $ID
PackageVersion: $V
DefaultLocale: pt-BR
ManifestType: version
ManifestVersion: 1.9.0
Y
cat > "$OUT/$ID.locale.pt-BR.yaml" <<Y
PackageIdentifier: $ID
PackageVersion: $V
PackageLocale: pt-BR
Publisher: Gabriel Waltrich
PublisherUrl: https://github.com/gabrielwaltrich
PackageName: Tramotak
PackageUrl: https://github.com/gabrielwaltrich/Tramotak
License: GPL-3.0-or-later
LicenseUrl: https://github.com/gabrielwaltrich/Tramotak/blob/main/LICENSE
ShortDescription: Central de estudos para os seus cursos
Tags: [estudo, cursos, flashcards, anki, fsrs]
ManifestType: defaultLocale
ManifestVersion: 1.9.0
Y
cat > "$OUT/$ID.installer.yaml" <<Y
PackageIdentifier: $ID
PackageVersion: $V
InstallerType: nullsoft
Scope: user
InstallerSwitches: {Silent: /S, SilentWithProgress: /S}
Installers:
  - Architecture: x64
    InstallerUrl: $URL
    InstallerSha256: $SHA
ManifestType: installer
ManifestVersion: 1.9.0
Y
echo "Manifestos em $OUT (valide com: winget validate $OUT)"
