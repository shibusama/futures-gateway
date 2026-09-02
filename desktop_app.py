#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
期界 · 桌面版入口（薄启动器）：真实实现见 desktop/app.py
开发：python desktop_app.py  或  run_desktop.bat
打包：build_desktop_exe.bat  →  dist/FuturesTerminal/FuturesTerminal.exe
"""
from desktop.app import main

if __name__ == "__main__":
    raise SystemExit(main())
