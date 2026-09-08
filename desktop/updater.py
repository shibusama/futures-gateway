# -*- coding: utf-8 -*-
"""Check public manifest / GitHub Releases and apply verified desktop updates."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

from app_paths import app_root, is_frozen
from app_version import (
    GITHUB_REPO,
    RELEASE_TAG_PREFIX,
    UPDATE_ASSET_NAME,
    UPDATE_MANIFEST_URL,
    __version__,
)


def parse_version(text: str) -> tuple[int, ...]:
    m = re.search(r"(\d+(?:\.\d+)*)", text or "")
    if not m:
        return (0,)
    return tuple(int(x) for x in m.group(1).split("."))


def current_version() -> tuple[int, ...]:
    return parse_version(__version__)


def _fetch_json(url: str, timeout: float = 12.0) -> dict | None:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "FuturesTerminal-Updater",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError):
        return None


def _api_url() -> str:
    return f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _pick_asset(release: dict) -> dict | None:
    for asset in release.get("assets") or []:
        if asset.get("name") == UPDATE_ASSET_NAME:
            return asset
    return None


def _info_from_manifest(data: dict) -> dict | None:
    version = (data.get("version") or "").strip()
    url = (data.get("url") or "").strip()
    if not version or not url:
        return None
    remote_ver = parse_version(version)
    if remote_ver <= current_version():
        return None
    return {
        "version": ".".join(str(x) for x in remote_ver),
        "tag": data.get("tag") or f"{RELEASE_TAG_PREFIX}{version}",
        "url": url,
        "sha256": (data.get("sha256") or "").strip().lower(),
        "notes": (data.get("notes") or "").strip(),
        "source": "manifest",
    }


def _info_from_github(release: dict) -> dict | None:
    tag = release.get("tag_name") or ""
    if RELEASE_TAG_PREFIX and not tag.startswith(RELEASE_TAG_PREFIX):
        return None
    remote_ver = parse_version(tag)
    if remote_ver <= current_version():
        return None
    asset = _pick_asset(release)
    if not asset or not asset.get("browser_download_url"):
        return None
    ver_label = ".".join(str(x) for x in remote_ver)
    return {
        "version": ver_label,
        "tag": tag,
        "url": asset["browser_download_url"],
        "sha256": "",
        "notes": (release.get("body") or "").strip(),
        "source": "github",
    }


def find_update() -> dict | None:
    """Return update info if a newer release exists."""
    if not is_frozen():
        return None

    manifest_url = (UPDATE_MANIFEST_URL or os.environ.get("FUTURES_UPDATE_MANIFEST_URL") or "").strip()
    if manifest_url:
        manifest = _fetch_json(manifest_url)
        if manifest:
            info = _info_from_manifest(manifest)
            if info:
                return info

    release = _fetch_json(_api_url())
    if not release:
        return None
    return _info_from_github(release)


def _download(url: str, dest: str, on_progress=None) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FuturesTerminal-Updater"})
    last_err: Exception | None = None
    for _attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                read = 0
                chunk_size = 256 * 1024
                with open(dest, "wb") as out:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        out.write(chunk)
                        read += len(chunk)
                        if on_progress:
                            on_progress(read, total)
            return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = exc
            if os.path.isfile(dest):
                try:
                    os.remove(dest)
                except OSError:
                    pass
    raise OSError(f"下载失败（已重试 3 次）：{last_err}")


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def _verify_download(path: str, expected: str) -> None:
    if not expected:
        return
    actual = _sha256_file(path)
    if actual != expected.lower():
        raise OSError(f"更新包校验失败（SHA256 不匹配）。\n期望：{expected}\n实际：{actual}")


def _safe_extract(zf: zipfile.ZipFile, dest: str) -> None:
    """逐成员解压并校验路径，拒绝绝对路径与 '..' 穿越（防 zip-slip 任意文件写）。"""
    dest_root = os.path.realpath(dest)
    for member in zf.infolist():
        name = member.filename.replace("\\", "/")
        if name.startswith("/") or ".." in name.split("/"):
            raise OSError(f"更新包包含非法路径：{member.filename!r}")
        target = os.path.realpath(os.path.join(dest_root, name))
        if target != dest_root and not target.startswith(dest_root + os.sep):
            raise OSError(f"更新包路径越界：{member.filename!r}")
        if member.is_dir():
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target) or dest_root, exist_ok=True)
        with zf.open(member, "r") as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)


def _update_workdir() -> str:
    work = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "FuturesTerminal", "update")
    os.makedirs(work, exist_ok=True)
    return work


def apply_log_path() -> str:
    """安装步骤日志（供诊断包与失败排查）。"""
    return os.path.join(_update_workdir(), "apply.log")


def _prepare_staging_dir(work: str) -> str:
    staging = os.path.join(work, "staging")
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)
    return staging


def _normalize_staging(staging: str) -> str:
    entries = os.listdir(staging)
    if len(entries) == 1:
        only = os.path.join(staging, entries[0])
        if os.path.isdir(only) and os.path.isfile(os.path.join(only, "FuturesTerminal.exe")):
            return only
    return staging


# PowerShell 落地安装脚本模板：固定内容，路径/PID 全部以 -File 参数传入，
# 避免旧版 batch 字符串拼接在路径含 & % ( ) 空格等字符时被破坏或截断。
#
# 流程（借鉴主流桌面更新器的常见做法：Chrome/VSCode/Squirrel 等）：
#   1. 等主界面进程 + 网关子进程都真正退出（带超时，避免文件锁未释放就动手）
#   2. 把旧安装目录整体 rename 到备份目录（而不是逐文件覆盖复制）——
#      这一步要么整体成功，要么整体失败，不会出现"新旧文件混杂"的中间态
#   3. 把新版本目录 rename/move 到安装目录
#   4. 启动新版本并做存活检查（health check）
#   5. 任何一步失败：自动回滚到备份、必要时重新拉起旧版本，并弹窗+写日志告知用户
#      （不再是静默 exit，不会出现"程序莫名消失"）
_APPLY_UPDATE_PS1 = r"""
param(
    [int]$MainPid = 0,
    [int]$GatewayPid = 0,
    [string]$AppDir,
    [string]$StagingDir,
    [string]$BackupDir,
    [string]$ExeName = "FuturesTerminal.exe",
    [string]$LogFile
)

$ErrorActionPreference = "Stop"

Add-Type -Name Win32Msg -Namespace FuturesTerminal -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
'@

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}

function Show-Fail([string]$msg) {
    Write-Log ("FAIL: " + $msg)
    $full = $msg + "`n`n日志：" + $LogFile
    # 0x1000 MB_SYSTEMMODAL | 0x10 MB_ICONERROR
    [FuturesTerminal.Win32Msg]::MessageBoxW([IntPtr]::Zero, $full, "期界 · 更新失败", 0x1010) | Out-Null
}

function Wait-ProcExit([int]$targetPid, [int]$timeoutSec) {
    if ($targetPid -le 0) { return $true }
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if (-not $p) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue))
}

function Move-DirRetry([string]$from, [string]$to, [int]$retries) {
    for ($i = 0; $i -lt $retries; $i++) {
        try {
            if (Test-Path $to) { Remove-Item $to -Recurse -Force -ErrorAction SilentlyContinue }
            try {
                Move-Item -Path $from -Destination $to -Force -ErrorAction Stop
            } catch {
                # Move-Item 对目录不支持跨磁盘卷（"must have identical roots"），
                # 退化为拷贝+删除（staging 目录在 LOCALAPPDATA，可能与安装目录不同盘）。
                Copy-Item -Path $from -Destination $to -Recurse -Force -ErrorAction Stop
                Remove-Item -Path $from -Recurse -Force -ErrorAction Stop
            }
            return $true
        } catch {
            Write-Log ("move '{0}' -> '{1}' attempt {2} failed: {3}" -f $from, $to, $i, $_.Exception.Message)
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

Write-Log ("=== apply-update start (main=$MainPid gateway=$GatewayPid) ===")

if (-not (Wait-ProcExit $MainPid 30)) {
    Show-Fail "主程序未能在 30 秒内退出，已取消本次更新（旧版本未受影响，可稍后重试）。"
    exit 1
}
Write-Log "main process exited"

if ($GatewayPid -gt 0 -and -not (Wait-ProcExit $GatewayPid 15)) {
    Write-Log "gateway pid $GatewayPid 仍存活，尝试强制结束"
    try { Start-Process -FilePath "taskkill.exe" -ArgumentList @("/PID", "$GatewayPid", "/F", "/T") -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 1
}
Write-Log "gateway process confirmed stopped"

if (-not (Move-DirRetry $AppDir $BackupDir 10)) {
    Show-Fail "无法访问安装目录（可能仍被安全软件或残留进程占用）。旧版本未受影响，可稍后重试更新。"
    exit 1
}
Write-Log "backed up old install to $BackupDir"

if (-not (Move-DirRetry $StagingDir $AppDir 5)) {
    Write-Log "install new version failed, rolling back"
    Move-DirRetry $BackupDir $AppDir 5 | Out-Null
    Show-Fail "安装新版本失败，已回滚到旧版本。"
    exit 1
}
Write-Log "new version installed to $AppDir"

$exePath = Join-Path $AppDir $ExeName
$newProc = $null
try {
    $newProc = Start-Process -FilePath $exePath -PassThru -ErrorAction Stop
} catch {
    Write-Log ("start new exe failed: " + $_.Exception.Message)
}

Start-Sleep -Seconds 3
$healthy = $false
if ($newProc -ne $null) {
    $check = Get-Process -Id $newProc.Id -ErrorAction SilentlyContinue
    if ($check) { $healthy = $true }
}

if (-not $healthy) {
    Write-Log "new version failed health check, rolling back and relaunching old version"
    try { Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    Move-DirRetry $BackupDir $AppDir 5 | Out-Null
    try { Start-Process -FilePath $exePath -ErrorAction SilentlyContinue } catch {}
    Show-Fail "新版本启动失败，已自动回滚并重新启动旧版本。"
    exit 1
}

Write-Log ("new version started ok (pid " + $newProc.Id + "), cleaning up backup")
try { Remove-Item $BackupDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
Write-Log "=== apply-update done ==="
"""


def _backup_dir_for(app: str) -> str:
    parent = os.path.dirname(os.path.normpath(app)) or app
    return os.path.join(parent, "_FuturesTerminal_backup")


def _apply_update(staging_dir: str, parent_pid: int | None = None, gateway_pid: int | None = None) -> None:
    app = app_root()
    work = _update_workdir()
    ps1_path = os.path.join(work, "apply_update.ps1")
    # 带 BOM 写入：Windows PowerShell 5.1（非 pwsh core）若无 BOM，
    # 会按系统 ANSI 代码页解析脚本文件，脚本里的中文会乱码甚至解析异常。
    with open(ps1_path, "w", encoding="utf-8-sig") as f:
        f.write(_APPLY_UPDATE_PS1)

    pid = parent_pid if parent_pid is not None else os.getpid()
    args = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", ps1_path,
        "-MainPid", str(pid),
        "-GatewayPid", str(gateway_pid or 0),
        "-AppDir", app,
        "-StagingDir", staging_dir,
        "-BackupDir", _backup_dir_for(app),
        "-ExeName", "FuturesTerminal.exe",
        "-LogFile", apply_log_path(),
    ]
    subprocess.Popen(
        args,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        close_fds=True,
    )


def download_and_extract(info: dict) -> str:
    from .update_progress import open_download_progress

    work = _update_workdir()
    zip_path = os.path.join(work, "pending.zip")
    staging = _prepare_staging_dir(work)

    progress = open_download_progress(f"期界 · 下载 v{info['version']}")
    try:
        def on_download(read: int, total: int) -> None:
            progress.set_phase("download", read, total)

        _download(info["url"], zip_path, on_progress=on_download)
        progress.set_phase("verify")
        _verify_download(zip_path, info.get("sha256") or "")
        progress.set_phase("extract")
        with zipfile.ZipFile(zip_path, "r") as zf:
            _safe_extract(zf, staging)
    finally:
        progress.close()

    staging = _normalize_staging(staging)
    if not os.path.isfile(os.path.join(staging, "FuturesTerminal.exe")):
        raise OSError("更新包格式异常：未找到 FuturesTerminal.exe")
    return staging


def run_update(info: dict, gateway_stop=None) -> None:
    staging = download_and_extract(info)
    gateway_pid = gateway_stop() if gateway_stop is not None else None
    _apply_update(staging, parent_pid=os.getpid(), gateway_pid=gateway_pid)


def check_and_prompt(silent: bool = False, gateway_stop=None) -> bool:
    """If update available, prompt user. Returns True when app should exit.

    gateway_stop: 可选回调，在真正落地安装前调用以同步停掉网关子进程，
    返回其 PID（或 None）供落地脚本再做一次兜底等待，避免网关仍占用安装目录里的
    文件（CTP SDK / Python 运行时 DLL 等）导致安装失败。
    """
    if "--no-update-check" in sys.argv:
        return False
    info = find_update()
    if not info:
        return False
    notes = info["notes"]
    if len(notes) > 280:
        notes = notes[:280] + "…"
    source_hint = ""
    if info.get("source") == "manifest":
        source_hint = "\n（更新源：公开清单）"
    body = (
        f"发现新版本 v{info['version']}（当前 v{__version__}）。\n\n"
        f"是否现在下载并安装？\n"
        f"将显示下载进度（约 56 MB），完成后程序会自动退出并重启。{source_hint}\n"
    )
    if notes:
        body += f"\n更新说明：\n{notes}\n"
    if info.get("sha256"):
        body += "\n将校验更新包 SHA256。\n"
    if silent:
        return False
    from .dialog import ask_yes_no, show_message

    if not ask_yes_no(body, "期界 · 检查更新"):
        return False
    try:
        staging = download_and_extract(info)
        gateway_pid = gateway_stop() if gateway_stop is not None else None
        _apply_update(staging, parent_pid=os.getpid(), gateway_pid=gateway_pid)
        show_message(
            "更新已下载。\n\n"
            "点击「确定」后程序将退出并完成安装，随后自动重启。\n"
            "请勿手动结束任务管理器中的 FuturesTerminal。",
            "期界 · 更新",
        )
        return True
    except Exception as exc:
        show_message(f"更新失败：{exc}", "期界 · 更新", error=True)
        return False


def check_only() -> int:
    info = find_update()
    if not info:
        print(f"已是最新版本 v{__version__}")
        return 0
    print(f"有新版本 v{info['version']}（当前 v{__version__}）")
    print(f"来源：{info.get('source', 'unknown')}")
    print(f"下载：{info['url']}")
    if info.get("sha256"):
        print(f"SHA256：{info['sha256']}")
    return 1
