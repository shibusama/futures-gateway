# futures-gateway · 本地 CTP (SimNow) 网关

多账户期货交易终端（网页端）的本地网关版：把原来的单文件模拟盘升级为 **真实 CTP 仿真数据**。

## 架构

```
浏览器网页 (web/)  ◄──WebSocket──►  Python 网关 (gateway/)  ◄──CTP协议──►  SimNow 仿真服务器
    127.0.0.1:8765                                                    （上期技术官方仿真）
```

- **网关**：Python + `openctp-ctp`（标准 CTP API 直译，自带官方 DLL），负责登录 SimNow、订阅行情、下单/撤单、回报推送
- **网页前端**：ES Module 结构（store / ws / chart / ui_*），数据源为网关 WebSocket 推送，界面复用「期界」多账户终端的设计

## 目录结构

```
├── gateway/                 # Python CTP 网关
│   ├── config.py
│   ├── ctp.py
│   ├── account_mgr.py
│   ├── server.py
│   ├── history.py
│   └── main.py
├── web/                     # 网页前端（浏览器 + 桌面版共用）
│   ├── index.html
│   ├── css/styles.css
│   └── js/
├── docs/                    # 需求与调研文档
├── installer/               # Inno Setup 安装包脚本
├── desktop_app.py           # PyWebView 桌面入口
├── desktop_single.py        # 单实例锁
├── desktop_updater.py       # GitHub Release 自动更新
├── app_paths.py             # 打包/开发路径
├── app_version.py           # 桌面版版本号
├── FuturesTerminal.spec     # PyInstaller 配置
├── build_desktop_exe.bat      # 打包 exe
├── build_desktop_release.bat  # 打包 exe + zip + 安装包
├── run_desktop.bat            # 桌面开发调试
├── start.bat                  # 浏览器 + 网关
├── config.json.example
└── requirements.txt
```

## 使用步骤

1. **注册 SimNow 仿真账号**：https://www.simnow.com.cn/ （手机号注册 → 实名 → 获得资金账号；BrokerID 固定 `9999`）
   - ⚠️ **首次登录必须修改密码**：要求 10 位以上、至少 3 种字符组合（大小写字母/数字/符号）。不改密码直接连 CTP 会报「密码过期 (141)」
2. **安装 Python 3.10+**（Windows，本项目在 3.14 实测通过）
3. **配置账号**：编辑 `config.json`，把 `user_id` / `password` 换成你的 SimNow 凭据；可配置多个账号（多账户）
4. **启动**：
   - 项目路径为纯英文 → 双击 `start.bat`（首次自动建虚拟环境并 `pip install -r requirements.txt`）
   - 项目路径含中文 → Windows 建 `.venv` 会失败（Python 已知问题），请手动执行：
     ```
     python -m venv C:\fg-venv
     C:\fg-venv\Scripts\pip install -r requirements.txt
     C:\fg-venv\Scripts\python -m gateway.main
     ```
5. **打开浏览器**访问：`http://127.0.0.1:8765`
   - 顶部徽标显示「CTP 已连接」即登录成功
   - 多账户概览：总权益 / 可用 / 浮动盈亏 / 保证金 + 账户列表 + 按品种汇总
   - 账户明细：真行情 K线 / 五档盘口 / 下单（SimNow 模拟单）

### 桌面版（推荐）

**日常使用 — 安装包或绿色版：**

1. **用户安装**：运行 `FuturesTerminal-Setup-x.y.z.exe`，或解压 `FuturesTerminal-win64.zip` / 复制整个 `FuturesTerminal` 文件夹  
2. 在 **exe 同目录** 放置 `config.json`（从 `config.json.example` 复制）  
3. 双击 `FuturesTerminal.exe`

**开发调试：** `run_desktop.bat`（不打包，直接 PyWebView）  
**重新配置账号：** `FuturesTerminal.exe --setup` 或开发时 `python desktop_app.py --setup`

| 能力 | 说明 |
|------|------|
| UI | 与浏览器 **100% 相同**（同一套 `web/`，但打包进 exe，非线上网页） |
| 首次配置 | 未填写 SimNow 账号时自动弹出配置向导（可测试连接） |
| 启动失败提示 | 网关启动失败时弹窗，并显示 `gateway.log` 摘要 |
| 网关 | 启动时自动拉起，关闭窗口时结束**本次**启动的网关 |
| 单实例 | 已运行时会提示，不会开多个窗口 |
| 检查更新 | 启动时询问；GitHub Release；菜单/关于/托盘也可检查 |
| 托盘 | 点 × 隐藏到托盘；托盘右键「退出」才完全关闭（含网关） |
| 菜单 | 文件（隐藏/退出）、帮助（关于/更新/诊断/配置） |
| 应用图标 | exe / 安装包 / 任务栏使用 `assets/icon.ico` |
| 日志 | exe 同目录 `gateway.log` |

#### 重要：改 web 后朋友桌面端会不会变？

**不会自动变。** 只 `git push` 到 GitHub，已安装桌面版的朋友**看不到**你的 web 修改。

桌面版把 `web/`、`gateway/` 等**打进 exe**，和 GitHub 仓库没有实时连接。必须发**新的桌面版 Release**，用户才会更新。

| 你的操作 | 朋友桌面端 |
|----------|------------|
| 只改 `web/` 并 push | ❌ 无变化 |
| 改代码 + 升版本 + 发 `desktop-v*` Release | ✅ 启动时提示更新，或手动重装 |

#### 桌面版发布 Checklist（维护者）

每次要让用户（或朋友）拿到新界面/新功能时，按顺序做：

- [ ] **1. 改代码** — 常见：`web/`（界面）、`gateway/`（后端）、`desktop_app.py` 等
- [ ] **2. 升版本号** — 编辑 `app_version.py` 里的 `__version__`（如 `1.0.0` → `1.0.1`）
- [ ] **3. 本地验证**
  - 浏览器：`start.bat` → 打开 `http://127.0.0.1:8765` 确认功能正常
  - 桌面：`run_desktop.bat` 或 `build_desktop_release.bat` 后运行 `dist\FuturesTerminal\FuturesTerminal.exe`
- [ ] **4. 本地打包** — 运行 `build_desktop_release.bat`，确认产出：
  - `dist\FuturesTerminal\FuturesTerminal.exe`（绿色版）
  - `dist\FuturesTerminal-win64.zip`（**自动更新用，必须上传 Release**）
  - `dist\installer\FuturesTerminal-Setup-x.y.z.exe`（可选，需 [Inno Setup 6](https://jrsoftware.org/isinfo.php)）
- [ ] **5. 提交并打 tag** — tag 格式必须为 `desktop-v` + 版本号，与 `__version__` 一致：

```bash
git add .
git commit -m "desktop 1.0.1: 简要说明改了什么"
git tag desktop-v1.0.1
git push origin master
git push origin desktop-v1.0.1
```

- [ ] **6. 手动发布 GitHub Release** — 本地打包完成后上传（朋友端会自动从 Release 检查更新）：

```bash
gh release create desktop-v1.0.1 \
  dist/FuturesTerminal-win64.zip \
  dist/installer/FuturesTerminal-Setup-1.0.1.exe \
  --title "Desktop v1.0.1" \
  --notes "更新说明"
```

- [ ] **6b.（可选）自建更新源** — 若不用 GitHub Release，可将 zip 放到 CDN/网盘，用 `update_manifest.example.json` + `UPDATE_MANIFEST_URL`（含 SHA256 校验）。

- [ ] **7. 通知用户**（任选其一）：
  - **自动更新**：用户重启程序，若 Release 版本高于本地版本会提示下载（需能访问 GitHub）
  - **手动分发**：把新的 `FuturesTerminal-Setup-x.y.z.exe` 或 zip 发给朋友

**版本规则：** 自动更新比较的是 exe 内嵌的 `__version__` 与 Release tag（`desktop-v1.0.1` → `1.0.1`）。只 push 代码、不升版本、不打 tag，用户端**永远不会**更新。

**首次发版：** 若仓库还没有任何 `desktop-v*` Release，自动更新不会生效；需至少完成一次上述 checklist。

**用户侧更新方式：**

| 方式 | 操作 |
|------|------|
| 自动 | 启动 `FuturesTerminal.exe`，按提示更新 |
| 手动 | 运行 `FuturesTerminal.exe --check-update` |
| 重装 | 运行新版 Setup，或解压 zip 覆盖原目录（保留同目录 `config.json`） |

## 配置说明（config.json）

```jsonc
{
  "host": "127.0.0.1",   // 网关监听地址（本机即可）
  "port": 8765,          // 网页 + WebSocket 共用端口
  "flow_dir": "flow",    // CTP 私有目录（自动建立）
  "accounts": [
    {
      "name": "SimNow一号",           // 界面显示名
      "user_id": "你的资金账号",       // CTP UserID
      "password": "你的密码",          // 修改过的新密码
      "broker_id": "9999",            // SimNow 固定 9999
      "trade_front": "tcp://182.254.243.31:30001",  // 看穿式交易前置（第一组）
      "md_front": "tcp://182.254.243.31:30011"      // 看穿式行情前置（第一组）
    }
  ]
}
```

### SimNow 前置地址（看穿式，三组任选其一）

| 组别 | Trade Front | Market Front |
|---|---|---|
| 第一组 | `tcp://182.254.243.31:30001` | `tcp://182.254.243.31:30011` |
| 第二组 | `tcp://182.254.243.31:30002` | `tcp://182.254.243.31:30012` |
| 第三组 | `tcp://182.254.243.31:30003` | `tcp://182.254.243.31:30013` |

- BrokerID 统一为 `9999`
- 认证凭据已内置在代码 `gateway/ctp.py` 中：默认 AppID `simnow_client_test`、认证码 16 个 `0`，无需在配置里填写
- 支持上期所 / 能源中心 / 中金所 / 广期所 / 郑商所 / 大商所的期货与期权

## 已知限制 / 后续

- 行情订阅的合约列表写死在前端 `ui_detail.js` 的 `SYMBOLS` 与网关 `ctp.py` 的 `DEFAULT_SYMBOLS`，后续可做成配置项/前端自选
- CTP 合约代码按季度换月，旧月份合约订阅会失败（网关会推送 error 提示），需同步更新
- 实盘 CTP 需要券商分配的 AppID/AuthCode/前置地址 + 穿透式监管认证，另见 [docs/ctp-technical-research.md](docs/ctp-technical-research.md)

## 依赖

> 本节由 `scripts/update_readme.py` 自动生成，请勿手改；真相源为 `requirements.txt`。

- `openctp-ctp` — 标准 CTP API 的 Python 直译封装，自带官方 DLL（行情 + 交易）
- `aiohttp` — 异步 Web 框架：静态前端 + WebSocket 实时推送
- `akshare` — 历史 K 线数据源（新浪期货分钟/日线，供图表回显）
