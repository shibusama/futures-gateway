#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Return 0 if version_info.txt matches app_version.py, else 1."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    av = (ROOT / "app_version.py").read_text(encoding="utf-8")
    vi_path = ROOT / "version_info.txt"
    if not vi_path.is_file():
        return 1
    vi = vi_path.read_text(encoding="utf-8")
    m = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', av)
    version = m.group(1) if m else ""
    if version and version in vi:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
