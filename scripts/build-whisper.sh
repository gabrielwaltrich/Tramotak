#!/usr/bin/env bash
# Compila o whisper-cli (whisper.cpp) para a transcrição embutida e copia para build/whisper.
# Uso: scripts/build-whisper.sh            (sistema atual)
#      WHISPER_MAC_ARCHS="arm64;x86_64" scripts/build-whisper.sh   (macOS universal)
# Requer git, cmake e um compilador C++ (no Windows, o MSVC do Visual Studio).
set -euo pipefail

VERSION="v1.9.5"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WHISPER_WORKDIR:-$ROOT/build/whisper-src}"
OUT="$ROOT/build/whisper"

if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp.git "$WORK"
fi

# Portátil: nada de -march=native (o binário tem que rodar em outros computadores); AVX2/FMA no x86,
# sem OpenMP (evita depender da libgomp) e com bibliotecas estáticas.
ARGS=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_BUILD_EXAMPLES=ON)
case "$(uname -s)" in
  Darwin)
    ARGS+=("-DCMAKE_OSX_ARCHITECTURES=${WHISPER_MAC_ARCHS:-$(uname -m)}" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0)
    ;;
  Linux)
    ARGS+=(-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=OFF
      "-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc")
    ;;
  MINGW* | MSYS* | CYGWIN*)
    ARGS+=(-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=OFF
      -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded)
    ;;
esac

cmake -S "$WORK" -B "$WORK/build" "${ARGS[@]}"
cmake --build "$WORK/build" --config Release -j 4 --target whisper-cli

mkdir -p "$OUT"
BIN="$(find "$WORK/build/bin" -maxdepth 2 -type f \( -name whisper-cli -o -name whisper-cli.exe \) | head -1)"
cp "$BIN" "$OUT/"
cp "$WORK/LICENSE" "$OUT/whisper.cpp-LICENSE.txt"
echo "whisper-cli copiado para $OUT"
