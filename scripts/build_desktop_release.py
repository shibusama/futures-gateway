#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run desktop release build without fragile .bat parsing in AI terminals."""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = Path(os.environ.get("FG_PYTHON", ""))
if not PY.is_file():
    for cand in (ROOT / ".venv" / "Scripts" / "python.exe", Path(r"C:\Users\13191\fg-venv\Scripts\python.exe")):
        if cand.is_file():
            PY = cand
            break
    else:
        PY = Path(sys.executable)

DIST = ROOT / "dist" / "FuturesTerminal"
ZIP = ROOT / "dist" / "FuturesTerminal-win64.zip"
ISCC_CANDIDATES = (
    Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
    Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
)


def run(args: list[str], **kwargs) -> None:
    print(">>", " ".join(str(a) for a in args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def main() -> int:
    sys.path.insert(0, str(ROOT))
    from app_version import __version__

    print("=" * 56)
    print(f" Build FuturesTerminal release  v{__version__}")
    print(f" Python: {PY}")
    print("=" * 56)

    run([str(PY), str(ROOT / "scripts" / "generate_version_info.py")])
    run([str(PY), "-m", "pip", "install", "-q", "pyinstaller", "pywebview", "-r", str(ROOT / "requirements.txt")])

    if (ROOT / "build").is_dir():
        shutil.rmtree(ROOT / "build", ignore_errors=True)
    if DIST.is_dir():
        shutil.rmtree(DIST, ignore_errors=True)
    if ZIP.is_file():
        ZIP.unlink()

    run([str(PY), "-m", "PyInstaller", "--noconfirm", "--clean", str(ROOT / "FuturesTerminal.spec")])

    exe = DIST / "FuturesTerminal.exe"
    if not exe.is_file():
        print("[ERROR] missing", exe)
        return 1

    example = ROOT / "config.json.example"
    if example.is_file() and not (ROOT / "config.json").is_file():
        shutil.copy2(example, DIST / "config.json.example")
    uninstall = ROOT / "uninstall.bat"
    if uninstall.is_file():
        shutil.copy2(uninstall, DIST / "uninstall.bat")

    print(f"Creating {ZIP.name} ...", flush=True)
    ZIP.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in DIST.rglob("*"):
            zf.write(path, path.relative_to(DIST))

    digest = hashlib.sha256(ZIP.read_bytes()).hexdigest()
    print("SHA256:", digest)

    iscc = next((p for p in ISCC_CANDIDATES if p.is_file()), None)
    setup = ROOT / "dist" / "installer" / f"FuturesTerminal-Setup-{__version__}.exe"
    if iscc:
        print("Building installer ...", flush=True)
        (ROOT / "dist" / "installer").mkdir(parents=True, exist_ok=True)
        run([str(iscc), f"/DMyAppVersion={__version__}", str(ROOT / "installer" / "FuturesTerminal.iss")])
    else:
        print("[hint] Inno Setup not found — skipped installer")

    print()
    print("Artifacts:")
    print(" ", exe)
    print(" ", ZIP)
    if setup.is_file():
        print(" ", setup)

    check = subprocess.run([str(exe), "--check-update"], capture_output=True, text=True)
    print()
    print(check.stdout.strip() or check.stderr.strip() or "(version check done)")
    if f"当前 v{__version__}" in (check.stdout + check.stderr):
        print("[OK] embedded version matches", __version__)
    elif "当前 v" in (check.stdout + check.stderr):
        print("[WARN] embedded version may still be stale — check output above")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
