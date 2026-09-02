#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate assets/icon.ico for PyInstaller and Inno Setup."""
from __future__ import annotations

from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:
    raise SystemExit("需要 Pillow：pip install pillow") from exc

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icon.ico"


def _draw(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = max(2, size // 8)
    draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=size // 5, fill=(47, 107, 255, 255))
    line_w = max(2, size // 16)
    points = [
        (size * 0.22, size * 0.62),
        (size * 0.40, size * 0.42),
        (size * 0.54, size * 0.72),
        (size * 0.78, size * 0.30),
    ]
    draw.line(points, fill=(255, 255, 255, 255), width=line_w, joint="curve")
    return img


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    images = [_draw(s) for s, _ in sizes]
    images[0].save(OUT, format="ICO", sizes=sizes)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
