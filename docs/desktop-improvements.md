# 桌面版完善清单

> PyWebView 桌面版（`desktop_app.py` + Inno Setup）与「标准桌面应用」的差距记录。  
> 按优先级分组，方便逐项挑选完善。最后更新：2026-09-02。

---

## 当前已具备

| 能力 | 状态 | 相关文件 |
|------|------|----------|
| 安装包（Setup.exe） | ✅ | `installer/FuturesTerminal.iss` |
| 绿色版 / zip 分发 | ✅ | `build_desktop_release.bat` |
| 单实例 | ✅ | `desktop_single.py` |
| 自动更新框架 | ✅ | `desktop_updater.py` |
| 卸载程序 | ✅ | Inno Setup |
| 用户数据与程序分离 | ✅ | exe 同目录 `config.json`、`flow/` |
| 网关后台无黑窗口 | ✅ | `desktop_app.py` |
| 关窗口顺带关网关 | ✅ | `desktop_app.py` |

对个人 / 小范围发给朋友：**核心可用**。

---

## 一、发给朋友时会明显感受到（优先看这里）

### 1. 没有代码签名

- **状态**：⬜ 未做
- **影响**：朋友需点「仍要运行」，显得不专业
- **标准做法**：购买代码签名证书，对 `FuturesTerminal.exe` 和 Setup 签名
- **工作量**：中（主要是证书费用 + 签名流程）
- **建议优先级**：⭐⭐⭐（对外分发越多越值得做）

### 2. 首次配置太「程序员向」

- **状态**：✅ 已实现（2026-09-02）— `web/setup.html` + `desktop_setup.py`；首次启动弹向导，支持测试连接；`FuturesTerminal.exe --setup` 可重新配置

### 3. 启动失败时用户几乎看不到提示

- **状态**：✅ 已实现（2026-09-02）— `desktop_dialog.py` 弹窗显示原因 + `gateway.log` 摘要

### 4. 自动更新对朋友可能无效

- **状态**：✅ 已解决 — 仓库已改为 **Public**；程序默认走 GitHub Releases API，朋友可自动更新
- **备选**：仍可用 `UPDATE_MANIFEST_URL` + SHA256（自建 CDN 时）

### 5. 没有应用图标

- **状态**：✅ 已实现（2026-09-02）— `assets/icon.ico`，PyInstaller + Inno Setup 已配置；可用 `scripts/generate_icon.py` 重新生成

---

## 二、标准桌面应用常见能力（尚未具备）

### 系统集成

| 功能 | 现状 | 工作量 | 建议优先级 |
|------|------|--------|------------|
| 系统托盘（最小化到托盘） | ✅ 点 × 隐藏到托盘；托盘右键退出 | 中 | — |
| 原生菜单（文件 / 帮助 / 关于 / 检查更新） | ✅ 已实现 | 中 | — |
| 日志轮转 / 导出诊断 | ✅ 已实现 | 小 | — |
| exe 属性版本信息 | ✅ 已实现（`version_info.txt`） | 小 | — |
| 关窗口强杀网关 | ✅ 托盘「退出」时关闭网关 | 小 | — |

### 更新机制

| 功能 | 现状 | 工作量 | 建议优先级 |
|------|------|--------|------------|
| 增量更新 | ❌ 每次整包 zip（~50MB+） | 大 | ⭐ |
| 更新失败回滚 | ❌ | 大 | ⭐ |
| 后台静默下载，重启再装 | ❌ 弹窗 + 退出覆盖 | 中 | ⭐⭐ |
| 更新包 SHA256 校验 | ✅ manifest 提供 sha256 时校验 | 中 | ⭐⭐ |
| 更新包代码签名校验 | ❌ | 中 | ⭐⭐ |
| 更新时文件占用处理 | ⚠️ robocopy，可能失败 | 中 | ⭐⭐ |

### 安全与配置

| 功能 | 现状 | 工作量 | 建议优先级 |
|------|------|--------|------------|
| 密码存 Windows 凭据库 | ❌ 明文 config.json | 中 | ⭐⭐ |
| 配置加密 | ❌ | 中 | ⭐ |
| 日志轮转 / 一键导出诊断 | ✅ gateway.log 超 2MB 轮转；菜单/关于可导出 zip | 小 | — |

---

## 三、打包与分发层面

| 项目 | 现状 | 说明 |
|------|------|------|
| 体积 | ~40MB 目录 + `_internal` | PyInstaller onedir，可接受 |
| 单文件 exe | ❌ | onefile 可选，启动更慢 |
| WebView2 依赖 | 需系统已装 | Win10/11 通常已有 |
| 仅 Windows | ✅ | macOS / Linux 需另做 |
| exe 属性里的版本信息 | ✅ FileVersion / ProductName | 可嵌入 FileVersion、CompanyName |

---

## 四、交易业务相关（朋友也会觉得「不完整」）

| 功能 | 现状 | 工作量 | 建议优先级 |
|------|------|--------|------------|
| 撤单按钮 | ✅ 委托列表「撤单」+ 网关 cancel | 小 | — |
| 合约列表写死 | ✅ 自选添加/移除，localStorage 持久化 | 中 | — |
| 断线重连提示 | ✅ 顶栏状态 + 横幅 + toast | 小 | — |
| UI 内增删账号 | 只能改 JSON | 大 | ⭐⭐ |

---

## 推荐实施路线（供挑选）

### 路线 A：最小改动，朋友体验立刻变好

适合：先发给 1～3 个朋友试用

1. 应用图标（`.ico`）
2. 启动失败弹窗（读 `gateway.log` 摘要）
3. 「关于」页 / 对话框（显示 `app_version.__version__`）
4. 安装后打开「配置说明」（README 片段或简单 HTML 页）

**预估**：1～2 天，几乎零成本。

### 路线 B：像正式产品一点

适合：打算长期维护、多人使用

在路线 A 基础上：

5. 首次启动配置向导（账号、密码、测试连接）
6. 启动 Loading 页
7. 安装向导中文化
8. 撤单按钮（web 层）

**预估**：约 1 周。

### 路线 C：对外商业化水准

适合：公开大规模分发

在路线 B 基础上：

9. 代码签名
10. 公开 Release 或独立更新 CDN + hash 校验
11. 密码进凭据库
12. 系统托盘 + 原生菜单

**预估**：持续投入 + 证书费用。

---

## 相关文件索引

| 文件 | 作用 |
|------|------|
| `desktop_app.py` | 桌面入口、网关子进程、WebView 窗口 |
| `desktop_updater.py` | GitHub Release 检查与 zip 覆盖更新 |
| `desktop_single.py` | Windows 单实例 |
| `app_version.py` | 版本号、Release tag 命名 |
| `app_paths.py` | 打包路径（exe 旁 vs bundle） |
| `FuturesTerminal.spec` | PyInstaller 打包 |
| `installer/FuturesTerminal.iss` | Inno Setup 安装包 |
| `build_desktop_release.bat` | exe + zip + Setup 一键构建 |

---

## 发版提醒（与完善项无关）

改 web / gateway 后，朋友桌面端**不会**自动变；需：

1. 升 `app_version.py`
2. `build_desktop_release.bat`
3. `git tag desktop-vX.Y.Z` + `gh release create …`

详见 [README.md](../README.md)「桌面版发布 Checklist」。
