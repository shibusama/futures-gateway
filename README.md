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
futures-gateway/
├── gateway/
│   ├── config.py        # 配置读取（config.json）
│   ├── ctp.py           # openctp_ctp 封装（行情 + 交易，一账号一实例）
│   ├── account_mgr.py   # 多账号管理 + WebSocket 广播
│   ├── server.py        # aiohttp：静态前端 + /ws
│   └── main.py          # 入口
├── web/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── store.js     # 状态仓库（纯逻辑）
│       ├── ws.js        # WebSocket 客户端
│       ├── chart.js     # K线渲染
│       ├── ui_overview.js  # 多账户概览
│       ├── ui_detail.js    # 账户明细（行情/盘口/下单/持仓）
│       └── app.js       # 装配与事件
├── config.json          # 账号配置（首次运行自动从示例生成）
├── config.json.example
├── requirements.txt
└── start.bat
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
- 桌面端（QT/PySide）为后续规划：届时复用 `store.js` 的状态逻辑或后端数据接口
- 实盘 CTP 需要券商分配的 AppID/AuthCode/前置地址 + 穿透式监管认证，另见 `ctp-technical-research.md`

## 依赖

> 本节由 `scripts/update_readme.py` 自动生成，请勿手改；真相源为 `requirements.txt`。

- `openctp-ctp` — 标准 CTP API 的 Python 直译封装，自带官方 DLL（行情 + 交易）
- `aiohttp` — 异步 Web 框架：静态前端 + WebSocket 实时推送
