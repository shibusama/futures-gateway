# 个人期货交易工具接入 CTP 技术调研（2025 调研纪要）

> 🗂️ **重要站点备忘（用户指定，务必记住）**
> - SimNow 产品页（账号/产品信息）：https://www.simnow.com.cn/product.action
> - SimNow 官网首页（注册入口）：https://www.simnow.com.cn/
> - 上期所官方模拟交易说明：https://edu.shfe.com.cn/home/simulate/simnow.html

调研时间：2025 年。标注：【已核实】= 有多方来源交叉印证或官方来源；【推测/需确认】= 基于发布形态与惯例推断，或细节以官方当前页面为准。

## 1. SimNow 仿真环境接入

- 【已核实】官方注册入口：https://www.simnow.com.cn/ （上期技术官方仿真平台）。流程：手机号/邮箱注册账号 → 填写实名信息（姓名、身份证号）→ 创建交易账号，获得**资金账号 + 密码**。
- 【已核实】拿到凭据：资金账号（CTP 登录的 UserID）、密码；**BrokerID 固定 9999**；仿真环境**不需要 AppID/AuthCode/证书**，直接账号+密码+9999 登录。
- 【推测/需确认】常用前置地址（多份教程/论坛广泛引用一致，建议以 SimNow 官网当前《使用手册》为准）：
  - 7x24 仿真：交易 `tcp://180.168.146.187:10101`，行情 `tcp://180.168.146.187:10111`；备用 `tcp://122.51.136.140:42205`（交易）/ `tcp://122.51.136.140:42213`（行情）
  - 日盘仿真（与实盘时段一致）：交易 `tcp://180.168.146.187:10130`，行情 `tcp://180.168.146.187:10131`
- 官方页面：上期所模拟交易页 https://edu.shfe.com.cn/home/simulate/simnow.html

## 2. 真实券商 CTP 接入

- 【已核实】所需配置/凭据：资金账号、登录密码、经纪公司代码（BrokerID）、交易/行情前置地址（front，由期货公司提供）、**AppID + AuthCode**（看穿式/穿透式监管客户端认证），交易中金所品种另需**数字证书**（以期货公司指引为准）。
- 【已核实】流程（见国泰君安期货申请流程、中信期货/华泰期货看穿式监管操作指南）：
  1. 在期货公司开立账户；
  2. 申请“程序化交易/量化/API 接入（CTP 专业版/机构版）”权限，签署协议（部分公司有资金门槛或交易经验要求）；
  3. 期货公司分配 BrokerID、前置地址、AppID/AuthCode（AppID 唯一标识你的客户端软件）；
  4. 用 SimNow 或期货公司测试环境联调；
  5. 验证通过后上线；日常报单需满足穿透式监管要求（2019-06 起强制，API 需 ≥6.3.13，走 ReqAuthenticate 认证）。
- 【推测/需确认】个人开发者能否拿到实盘 AppID/AuthCode 视期货公司政策而定。

## 3. Python 连接方案对比（Windows）

| 方案 | 安装难度 | 成熟度 |
| --- | --- | --- |
| vnpy_ctp（vn.py 官方 CTP 网关）| 低：`pip install vnpy_ctp`，wheel 自带官方 DLL | 最高，维护活跃，文档齐全 |
| openctp-ctp-python | 低：pip 可装，ctypes 封装，兼容 SimNow/openctp 模拟盘 | 中，个人项目但常更新 |
| keli/ctp-python | 中：多需自行编译/配预编译包，Python 版本兼容旧 | 中低，更新停滞（穿透式版本封装）|
| pyminiapi | 未确认：未能检索到可靠官方来源（疑似小众/易混淆）| 未确认 |

## 4. 浏览器能否直接运行 CTP

- 【已核实】不能。CTP 官方以 **Windows 原生 DLL**（ThostFtdcTraderApi.dll / ThostFtdcMdApi.dll）、Linux .so、Java 形式发布；浏览器无法加载原生 DLL。
- 【推测】官方未见 JS/WASM 版本（按官方发布形态判断）。
- 【已核实+推测】典型架构：**本地网关进程（Python/C++ 封装 CTP DLL）+ 网页前端经 WebSocket/HTTP 通信**。先例：WebCTP（tab1949/WebCTP）、vnpy 的 WebTrader、openctp 等均为此模式。

## 最有用的来源

- SimNow 官网（注册）：https://www.simnow.com.cn/
- 上期所官方模拟交易说明：https://edu.shfe.com.cn/home/simulate/simnow.html
- vnpy_ctp 官方仓库 README：https://github.com/vnpy/vnpy_ctp
- vnpy_ctp PyPI：https://pypi.org/project/vnpy-ctp/
- 中信期货《看穿式监管认证操作指南（CTP 系统）》PDF：https://www.citicf.com/static/download/soft/中信期货看穿式监管认证操作指南（CTP系统）.pdf
- 国泰君安期货量化接口申请流程：https://licai.cofool.com/ask/qa_7268435_1_2.html
- WebCTP（WebSocket 网关先例）：https://github.com/tab1949/WebCTP
- CTP API 中文文档（CTP-API-cn 镜像）：https://documentation.help/CTP-API-cn/ZY.html