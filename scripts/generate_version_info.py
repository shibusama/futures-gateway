#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate PyInstaller Windows version_info.txt from app_version.py."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "version_info.txt"


def _file_version(version: str) -> tuple[int, int, int, int]:
    parts = [int(x) for x in version.split(".") if x.isdigit()]
    while len(parts) < 4:
        parts.append(0)
    return tuple(parts[:4])


def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from app_version import __version__

    fv = _file_version(__version__)
    text = f"""# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={fv},
    prodvers={fv},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904B0',
        [
          StringStruct('CompanyName', 'Futures Gateway'),
          StringStruct('FileDescription', '期界期货交易终端'),
          StringStruct('FileVersion', '{__version__}'),
          StringStruct('InternalName', 'FuturesTerminal'),
          StringStruct('LegalCopyright', 'Futures Gateway'),
          StringStruct('OriginalFilename', 'FuturesTerminal.exe'),
          StringStruct('ProductName', '期界期货交易终端'),
          StringStruct('ProductVersion', '{__version__}'),
        ])
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
