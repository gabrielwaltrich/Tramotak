"""Gera resources/icon.png (1024×1024): quadrado roxo arredondado com um triângulo de play.

Sem dependências: desenha pixel a pixel com supersampling 4× e grava PNG com zlib.
Uso: python3 scripts/make-icon.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 1024
SS = 4  # amostras por eixo, para bordas suaves
RADIUS = 0.22  # raio dos cantos, fração do lado
TOP = (139, 92, 246)  # #8b5cf6
BOTTOM = (109, 40, 217)  # #6d28d9


def inside_rounded_square(x: float, y: float) -> bool:
    m = 0.06  # margem
    r = RADIUS
    lo, hi = m, 1 - m
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    cx = min(max(x, lo + r), hi - r)
    cy = min(max(y, lo + r), hi - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


# Triângulo de play levemente deslocado à direita para parecer centrado.
TRI = [(0.40, 0.30), (0.40, 0.70), (0.72, 0.50)]


def inside_triangle(x: float, y: float) -> bool:
    (x1, y1), (x2, y2), (x3, y3) = TRI
    d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
    d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
    d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def pixel(px: int, py: int) -> tuple[int, int, int, int]:
    bg = white = 0
    for sy in range(SS):
        for sx in range(SS):
            x = (px + (sx + 0.5) / SS) / SIZE
            y = (py + (sy + 0.5) / SS) / SIZE
            if inside_rounded_square(x, y):
                if inside_triangle(x, y):
                    white += 1
                else:
                    bg += 1
    total = SS * SS
    alpha = (bg + white) / total
    if alpha == 0:
        return (0, 0, 0, 0)
    t = py / SIZE
    base = [round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)]
    w = white / (bg + white)
    rgb = [round(base[i] * (1 - w) + 255 * w) for i in range(3)]
    return (*rgb, round(alpha * 255))


def write_png(path: Path) -> None:
    rows = bytearray()
    for py in range(SIZE):
        rows.append(0)  # filtro "None"
        for px in range(SIZE):
            rows.extend(pixel(px, py))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows), 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'resources' / 'icon.png'
    write_png(out)
    print(f'{out} ({out.stat().st_size // 1024} KB)')
