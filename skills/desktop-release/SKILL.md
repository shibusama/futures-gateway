---
name: desktop-release
description: >-
  MUST USE when the user asks to 发版/release/publish desktop version/发布新版本/教你发版
  for futures-gateway (期界桌面版). Runs the full OSS + GitHub Release workflow
  without asking the user to remember steps.
---

# 期界桌面版发版流程

用户说「发版」「发布」「release」时，**按此流程自动执行**，不要让用户记步骤。

## 前置条件

- 工作目录：仓库根目录
- `oss_release.env` 已存在（从 `oss_release.env.example` 复制，含 AccessKey，**勿提交 git**）
- `gh` 已登录 GitHub
- 若缺 release notes，从本次改动或用户描述生成简短中文说明

## 四步流程（按顺序执行）

### 1. 升版本号

编辑 `app_version.py` 的 `__version__`（如 `1.0.7` → `1.0.8`）。

规则：Release tag 为 `desktop-v{version}`，与 `RELEASE_TAG_PREFIX` + version 一致。

### 2. 打包

```bat
build_desktop_release.bat
```

- 日常仅验证 exe 可用 `build_desktop_exe.bat`（只出 exe），但**正式发版用 release 脚本**（含 zip、可选 Setup）
- 产物：`dist/FuturesTerminal/`、`dist/FuturesTerminal-win64.zip`、可选 `dist/installer/FuturesTerminal-Setup-{ver}.exe`

若 zip 未生成，用 PowerShell：

```powershell
Compress-Archive -Path dist/FuturesTerminal/* -DestinationPath dist/FuturesTerminal-win64.zip -Force
```

### 3. 上传 OSS（国内下载 + 自动更新）

```bat
pip install oss2
python scripts/publish_oss_release.py --notes "vX.Y.Z: 更新说明"
```

固定 URL（已在 `app_version.py` 的 `UPDATE_MANIFEST_URL`）：

- manifest: `https://shibusama-futures.oss-cn-hangzhou.aliyuncs.com/futures-gateway/update_manifest.json`
- zip: `https://shibusama-futures.oss-cn-hangzhou.aliyuncs.com/futures-gateway/releases/FuturesTerminal-win64.zip`

上传后验证 manifest 可公开访问且 `version` 字段为新版本。

若公共读失败，用 oss2 设置 bucket/object ACL 为 `public-read`（见历史脚本逻辑）。

**manifest 里的 url 指向 OSS zip**；已打包 exe 内置 `UPDATE_MANIFEST_URL`，无需再改（除非换 bucket）。

### 4. Git + GitHub Release

```bat
git add app_version.py
git commit -m "desktop X.Y.Z: 简要说明"
git push origin master
git tag desktop-vX.Y.Z
git push origin desktop-vX.Y.Z
```

创建 Release（zip 必传；有 Setup 则一并上传）：

```bat
gh release create desktop-vX.Y.Z dist/FuturesTerminal-win64.zip --title "Desktop vX.Y.Z" --notes "..."
```

Release notes **必须包含**国内 OSS 直链：

```markdown
## 下载
- **国内推荐（快）**: https://shibusama-futures.oss-cn-hangzhou.aliyuncs.com/futures-gateway/releases/FuturesTerminal-win64.zip
- GitHub 附件（备用）: 见下方 Assets

## 更新内容
- ...
```

有 Setup exe 时：

```bat
gh release create desktop-vX.Y.Z dist/FuturesTerminal-win64.zip dist/installer/FuturesTerminal-Setup-X.Y.Z.exe --title "..." --notes "..."
```

## 分工（向用户解释时用）

| 地方 | 作用 |
|------|------|
| **OSS** | 朋友下载快 + 自动更新走 manifest |
| **GitHub Release** | 版本记录、changelog、备用下载 |

## 禁止

- 勿提交 `oss_release.env`、`config.json`
- 勿在聊天中复述 AccessKey Secret
- 用户未要求时不要 force push
- 版本号未升时不要发版（否则朋友收不到更新提示）

## 常见坑（实操踩过，务必避开）

1. **打包脚本用直接调用，别用 `cmd //c`**。
   在 Git Bash（尤其后台任务）里 `cmd //c build_desktop_release.bat` 会报 "not recognized"（cmd 找不到 bat）。正确：
   `./build_desktop_release.bat`（或 `cmd //c "build_desktop_release.bat"`）。后台跑用 `"./build_desktop_release.bat" > /tmp/rel.log 2>&1`。
2. **push tag 偶发网络中断，重试即可**。`git push origin desktop-vX.Y.Z` 可能报 `Recv failure: Connection was reset`，重试一次即成功。
3. **顺序别乱**：先 `git push origin desktop-vX.Y.Z` **成功**，再 `gh release create`（否则 gh 报 "tag 未推送"）。
4. **产物核对**：打包后确认 `dist/FuturesTerminal/FuturesTerminal.exe`、`dist/FuturesTerminal-win64.zip`、`dist/installer/FuturesTerminal-Setup-{ver}.exe` 都生成。
5. **OSS 验证**：上传后 `curl` manifest 确认 `version` 为新版本、zip 返回 200。
6. **勿误提交**：`.claude/`（含 cftunnel.log）、`oss_release.env`、`config.json` 都应被 .gitignore 排除，`git add -A` 前核对 `git status` 无这些文件。

## 完成后汇报

给用户：

1. GitHub Release URL
2. OSS 直链
3. 版本号
4. 朋友如何从旧包迁移（首次需装带 OSS manifest 的新包，之后自动更新走 OSS）

## 参考

- 详细 OSS 首次配置：`docs/oss-release-setup.md`
- 发版脚本：`scripts/publish_oss_release.py`
- 更新逻辑：`desktop/updater.py`
