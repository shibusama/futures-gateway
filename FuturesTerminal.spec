# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — run via build_desktop_exe.bat

import sys
from pathlib import Path

ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / "desktop_app.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / "web"), "web"),
        (str(ROOT / "config.json.example"), "."),
    ],
    hiddenimports=[
        "app_paths",
        "app_version",
        "desktop_updater",
        "desktop_single",
        "webview",
        "gateway",
        "gateway.main",
        "gateway.server",
        "gateway.account_mgr",
        "gateway.ctp",
        "gateway.config",
        "gateway.history",
        "openctp_ctp",
        "openctp_ctp.thosttraderapi",
        "openctp_ctp.thostmduserapi",
        "aiohttp",
        "akshare",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FuturesTerminal",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="FuturesTerminal",
)
