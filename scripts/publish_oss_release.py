#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上传桌面版 zip + update_manifest.json 到阿里云 OSS。

用法（在项目根目录）：
  1. 复制 oss_release.env.example → oss_release.env 并填写
  2. build_desktop_release.bat
  3. python scripts/publish_oss_release.py [--notes "更新说明"]

依赖：pip install oss2
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

ENV_PATH = os.path.join(ROOT, "oss_release.env")
ZIP_NAME = "FuturesTerminal-win64.zip"


def _load_env(path: str) -> dict[str, str]:
    if not os.path.isfile(path):
        print(f"[错误] 未找到 {path}")
        print("  请复制 oss_release.env.example 为 oss_release.env 并填写。")
        sys.exit(1)
    data: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            data[key.strip()] = val.strip()
    return data


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _require(cfg: dict[str, str], key: str) -> str:
    val = (cfg.get(key) or "").strip()
    if not val or "你的" in val or val.startswith("示例"):
        print(f"[错误] oss_release.env 中 {key} 未填写")
        sys.exit(1)
    return val


def _join_url(base: str, *parts: str) -> str:
    base = base.rstrip("/")
    path = "/".join(p.strip("/") for p in parts if p)
    return f"{base}/{path}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish desktop release to Aliyun OSS")
    parser.add_argument("--notes", default="", help="更新说明（写入 manifest）")
    parser.add_argument("--dry-run", action="store_true", help="只生成 manifest，不上传")
    args = parser.parse_args()

    try:
        import oss2
    except ImportError:
        print("[错误] 请先安装：pip install oss2")
        return 1

    from app_version import RELEASE_TAG_PREFIX, UPDATE_ASSET_NAME, __version__

    cfg = _load_env(ENV_PATH)
    ak = _require(cfg, "OSS_ACCESS_KEY_ID")
    sk = _require(cfg, "OSS_ACCESS_KEY_SECRET")
    endpoint = _require(cfg, "OSS_ENDPOINT")
    bucket_name = _require(cfg, "OSS_BUCKET")
    prefix = _require(cfg, "OSS_PREFIX").strip("/")
    manifest_key = _require(cfg, "OSS_MANIFEST_KEY").strip("/")
    public_base = _require(cfg, "OSS_PUBLIC_BASE")

    zip_path = os.path.join(ROOT, "dist", ZIP_NAME)
    if not os.path.isfile(zip_path):
        print(f"[错误] 未找到 {zip_path}，请先运行 build_desktop_release.bat")
        return 1

    if UPDATE_ASSET_NAME != ZIP_NAME:
        print(f"[警告] UPDATE_ASSET_NAME={UPDATE_ASSET_NAME}，上传文件为 {ZIP_NAME}")

    sha = _sha256(zip_path)
    tag = f"{RELEASE_TAG_PREFIX}{__version__}"
    zip_key = f"{prefix}/{ZIP_NAME}" if prefix else ZIP_NAME
    zip_url = _join_url(public_base, zip_key)

    manifest = {
        "version": __version__,
        "tag": tag,
        "url": zip_url,
        "sha256": sha,
        "notes": (args.notes or "").strip(),
    }

    manifest_path = os.path.join(ROOT, "dist", "update_manifest.json")
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    manifest_url = _join_url(public_base, manifest_key)
    print("=" * 56)
    print(f" 版本     : {__version__}")
    print(f" ZIP      : {zip_path}")
    print(f" SHA256   : {sha}")
    print(f" ZIP URL  : {zip_url}")
    print(f" Manifest : {manifest_path}")
    print(f" Manifest URL: {manifest_url}")
    print("=" * 56)
    print()
    print("请将 app_version.py 中 UPDATE_MANIFEST_URL 设为：")
    print(f'  UPDATE_MANIFEST_URL = "{manifest_url}"')
    print("然后重新 build_desktop_exe.bat（或 release）使新版本 exe 内置该地址。")

    if args.dry_run:
        print("\n[dry-run] 已生成 manifest，未上传。")
        return 0

    auth = oss2.Auth(ak, sk)
    bucket = oss2.Bucket(auth, f"https://{endpoint}", bucket_name)

    print("\n上传 zip …")
    bucket.put_object_from_file(zip_key, zip_path)
    print("上传 manifest …")
    bucket.put_object(
        manifest_key,
        json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )

    print("\n[完成] OSS 发布成功。")
    print(f"  测试 manifest: curl \"{manifest_url}\"")
    print(f"  测试下载 zip:  浏览器打开 {zip_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
