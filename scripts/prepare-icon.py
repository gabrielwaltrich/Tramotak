"""Gera os ícones a partir da arte original (resources/icon-source.png).

A arte tem um brilho irregular em volta do quadrado; aqui ele é cortado por uma máscara de cantos
arredondados (desenhada 4× maior para a borda ficar suave) e o quadrado vai para uma tela de 1024×1024
com margem transparente. Também gera o logo pequeno da barra lateral.

Uso: python3 scripts/prepare-icon.py   (precisa do Pillow)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'resources' / 'icon-source.png'
BOX = (82, 94, 1173, 1173)  # quadrado sólido da arte, 2 px para dentro da borda com brilho
RADIUS = 296  # raio dos cantos na arte original
SIZE = 1024
MARGIN = 0.07  # margem transparente em volta (fração do lado)
SS = 4


def rounded_mask(width: int, height: int, radius: int) -> Image.Image:
    big = Image.new('L', (width * SS, height * SS), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, width * SS - 1, height * SS - 1), radius=radius * SS, fill=255)
    return big.resize((width, height), Image.LANCZOS)


def main() -> None:
    art = Image.open(SOURCE).convert('RGBA').crop(BOX)
    w, h = art.size
    r, g, b, a = art.split()
    art = Image.merge('RGBA', (r, g, b, ImageChops.multiply(a, rounded_mask(w, h, RADIUS))))

    inner = round(SIZE * (1 - 2 * MARGIN))
    icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(art.resize((inner, inner), Image.LANCZOS), ((SIZE - inner) // 2,) * 2)
    icon.save(ROOT / 'resources' / 'icon.png', optimize=True)

    # Linux: um arquivo por tamanho (o tema de ícones escolhe o mais próximo).
    linux = ROOT / 'resources' / 'icons'
    linux.mkdir(exist_ok=True)
    for size in (16, 24, 32, 48, 64, 128, 256, 512):
        icon.resize((size, size), Image.LANCZOS).save(linux / f'{size}x{size}.png', optimize=True)

    # Logo da barra lateral: o quadrado sem margem, em 2× para telas de alta densidade.
    art.resize((96, 96), Image.LANCZOS).save(ROOT / 'src' / 'renderer' / 'src' / 'assets' / 'logo.png', optimize=True)
    print('resources/icon.png, resources/icons/ e src/renderer/src/assets/logo.png gerados')


if __name__ == '__main__':
    main()
