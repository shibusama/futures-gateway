# -*- coding: utf-8 -*-
"""aiohttp 服务：静态文件（前端）+ WebSocket（实时数据 / 下单指令）。"""
import asyncio
import json
import mimetypes
import os
import time
import webbrowser

from collections import deque

from aiohttp import web

from .auth import SiteAuth, verify_site_auth
from .config import load_config
from .history import fetch_bars

from app_paths import bundle_root, is_frozen

mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".mjs")


def _dev_mode() -> bool:
    """开发/桌面调试时不缓存前端，改完代码刷新即可生效。"""
    return os.environ.get("FUTURES_DESKTOP") == "1" or not is_frozen()


@web.middleware
async def dev_no_cache_middleware(request, handler):
    response = await handler(request)
    if not _dev_mode():
        return response
    path = request.path.lower()
    if path == "/" or path.endswith((".js", ".mjs", ".css", ".html")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def web_dir() -> str:
    bundled = os.path.join(bundle_root(), "web")
    if os.path.isdir(bundled):
        return bundled
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


WEB_DIR = web_dir()

# 免鉴权的 API：登录 / 会话状态 / 登出。其余 /api/* 与 /ws 在“非本机 Host”时需先登录。
OPEN_API = {"/api/login", "/api/session", "/api/logout"}

# 防双击/重发：记录最近下单指纹，时间窗内同参数报单视为重复直接忽略
_RECENT_ORDERS = deque(maxlen=32)
_ORDER_DUP_WINDOW_SEC = 1.0


def _auth_middleware(site_auth: SiteAuth):
    @web.middleware
    async def auth_middleware(request, handler):
        if not site_auth.enabled:
            return await handler(request)
        path = request.path
        protected = (path.startswith("/api/") and path not in OPEN_API) or path == "/ws"
        if protected and not site_auth.is_authorized(request):
            return web.json_response({"ok": False, "msg": "需要先登录"}, status=401)
        return await handler(request)

    return auth_middleware


async def login_handler(request):
    """POST /api/login  {password} —— 成功则种下 HttpOnly 会话 Cookie。"""
    sa: SiteAuth = request.app["site_auth"]
    if not sa.enabled:
        return web.json_response({"ok": False, "msg": "未启用站点口令"}, status=400)
    ip = sa.client_ip(request)
    if sa.sessions.is_blocked(ip):
        return web.json_response({"ok": False, "msg": "尝试次数过多，请稍后再试"}, status=429)
    try:
        body = await request.json()
    except Exception:
        body = {}
    pw = body.get("password") if isinstance(body, dict) else None
    if not isinstance(pw, str) or not verify_site_auth(sa.site_auth, pw):
        sa.sessions.record_failure(ip)
        return web.json_response({"ok": False, "msg": "口令错误"}, status=401)
    sa.sessions.clear_failures(ip)
    resp = web.json_response({"ok": True})
    sa.attach_session(resp)
    return resp


async def session_handler(request):
    """GET /api/session —— 返回当前是否已通过鉴权（本机访问恒为 true）。"""
    sa: SiteAuth = request.app["site_auth"]
    return web.json_response({"ok": True, "authenticated": sa.is_authorized(request)})


async def logout_handler(request):
    """POST /api/logout —— 使当前会话失效。"""
    sa: SiteAuth = request.app["site_auth"]
    resp = web.json_response({"ok": True})
    if sa.enabled:
        sa.detach_session(request, resp)
    return resp


def build_app(mgr, config=None):
    site_auth = SiteAuth((config or {}).get("site_auth"))
    middlewares = [_auth_middleware(site_auth)]
    if _dev_mode():
        middlewares.append(dev_no_cache_middleware)
    app = web.Application(middlewares=middlewares)
    app["mgr"] = mgr
    app["site_auth"] = site_auth

    # 站点口令（登录 / 会话 / 登出）
    app.router.add_post("/api/login", login_handler)
    app.router.add_get("/api/session", session_handler)
    app.router.add_post("/api/logout", logout_handler)

    # 静态前端
    app.router.add_get("/api/app-info", app_info_handler)
    app.router.add_get("/api/boot-status", boot_status_handler)
    app.router.add_get("/api/bars", bars_handler)
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/", WEB_DIR, show_index=True)

    return app


async def boot_status_handler(request):
    """供启动页轮询：CTP 交易登录成功后才进入主界面。"""
    mgr = request.app["mgr"]
    raw = mgr.status()
    last_states = raw.get("last_states") or {}
    accounts = []
    for name in raw.get("accounts") or []:
        st = last_states.get(name) or {}
        login = st.get("login")
        accounts.append({
            "name": name,
            "login": login,
            "msg": st.get("login_msg") or st.get("login_msg_md") or "",
            "has_balance": bool(st.get("balance")),
        })
    logins = [a.get("login") for a in accounts]
    return web.json_response({
        "ok": True,
        "accounts": accounts,
        "ready": bool(accounts) and all(x == "ok" for x in logins),
        "failed": any(x == "fail" for x in logins),
    })


async def app_info_handler(request):
    info = {
        "desktop": os.environ.get("FUTURES_DESKTOP") == "1",
        "version": "dev",
        "github": "https://github.com/shibusama/futures-gateway",
        "releases": "https://github.com/shibusama/futures-gateway/releases",
    }
    try:
        from app_version import GITHUB_REPO, __version__

        info["version"] = __version__
        info["github"] = f"https://github.com/{GITHUB_REPO}"
        info["releases"] = f"https://github.com/{GITHUB_REPO}/releases"
    except ImportError:
        pass
    return web.json_response(info)


async def index_handler(request):
    return web.FileResponse(os.path.join(WEB_DIR, "index.html"))


async def bars_handler(request):
    """GET /api/bars?symbol=rb2610&period=1m"""
    symbol = request.query.get("symbol", "")
    period = request.query.get("period", "1m")
    if period not in ("1m", "5m", "1d"):
        period = "1m"
    bars = await asyncio.to_thread(fetch_bars, symbol, period)
    return web.json_response({"ok": True, "symbol": symbol.upper(), "period": period, "bars": bars})


async def websocket_handler(request):
    mgr = request.app["mgr"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    mgr.add_client(ws)
    try:
        # 新客户端连上：先推送当前网关状态（账号登录情况）
        await ws.send_str(json.dumps({"type": "system", "cmd": "hello", "data": mgr.status()}, ensure_ascii=False))
        # 已登录但资金尚未缓存时，主动触发一次查询（CTP 结算确认后才有资金）
        st = mgr.status().get("last_states") or {}
        if any(s.get("login") == "ok" and not s.get("balance") for s in st.values()):
            mgr.query_all()
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    payload = json.loads(msg.data)
                except Exception:
                    payload = {}
                cmd = payload.get("cmd")
                if cmd == "query":
                    mgr.query_all()  # 触发所有账号刷新数据，结果经广播推回
                    await ws.send_str(json.dumps({"type": "system", "cmd": "query_ok"}, ensure_ascii=False))
                elif cmd == "ping":
                    await ws.send_str(json.dumps({"type": "pong"}, ensure_ascii=False))
                elif cmd == "order":
                    try:
                        sig = (
                            payload.get("account"),
                            payload.get("symbol"),
                            payload.get("direction"),
                            payload.get("offset"),
                            payload.get("price"),
                            payload.get("volume"),
                        )
                        now = time.monotonic()
                        if any(ts >= now - _ORDER_DUP_WINDOW_SEC and s == sig for s, ts in _RECENT_ORDERS):
                            result = {"ok": False, "msg": "检测到 1 秒内重复的相同报单，已忽略"}
                        else:
                            _RECENT_ORDERS.append((sig, now))
                            # 字段类型/范围由 CtpGateway.send_order 统一强校验，这里不再裸转避免抛异常断连
                            result = mgr.send_order(
                                account=payload.get("account"),
                                symbol=payload.get("symbol"),
                                direction=payload.get("direction"),
                                offset=payload.get("offset"),
                                price=payload.get("price"),
                                volume=payload.get("volume"),
                            )
                    except Exception as exc:
                        result = {"ok": False, "msg": f"下单指令异常：{exc}"}
                    await ws.send_str(json.dumps({"type": "system", "cmd": "order_result", "data": result}, ensure_ascii=False))
                elif cmd == "cancel":
                    result = mgr.cancel_order(
                        account=payload.get("account"),
                        order_sys_id=payload.get("order_sys_id"),
                        symbol=payload.get("symbol"),
                        exchange=payload.get("exchange"),
                    )
                    await ws.send_str(json.dumps({"type": "system", "cmd": "cancel_result", "data": result}, ensure_ascii=False))
                elif cmd == "subscribe":
                    result = mgr.subscribe_symbols(payload.get("symbols") or [])
                    await ws.send_str(json.dumps({"type": "system", "cmd": "subscribe_result", "data": result}, ensure_ascii=False))
                elif cmd == "status":
                    await ws.send_str(json.dumps({"type": "system", "cmd": "status", "data": mgr.status()}, ensure_ascii=False))
            elif msg.type == web.WSMsgType.ERROR:
                break
    finally:
        mgr.remove_client(ws)
    return ws


def run_server(mgr, config):
    app = build_app(mgr, config)
    host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))

    sa: SiteAuth = app["site_auth"]
    if not sa.enabled and host not in ("127.0.0.1", "localhost", "::1"):
        print(f"\n [错误] 站点口令未启用，但 host 配置为非本机地址（{host}）。")
        print("        为避免局域网/公网无鉴权暴露下单与撤单接口，已拒绝启动。")
        print("        · 需要在 config.json 的 site_auth 中配置口令后才能对外提供服务；")
        print("        · 或把 host 改回 127.0.0.1（仅本机访问）。")
        raise SystemExit(1)
    if sa.enabled:
        print("  站点口令：已启用（非本机 Host 访问需登录）")
    else:
        print("  站点口令：未启用（无鉴权，仅供本机/内网使用）")

    # 显式创建事件循环并绑定给账号管理器（Python 3.12+ 不再隐式提供默认循环）
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    mgr.loop = loop

    async def _serve():
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, host, port)
        await site.start()
        open_host = host if host not in ("0.0.0.0", "::") else "127.0.0.1"
        url = f"http://{open_host}:{port}"
        print(f"  服务已启动: {url}  （Ctrl+C 停止）")
        if not os.environ.get("FUTURES_DESKTOP"):
            webbrowser.open(f"{url}/loading.html")
        try:
            while True:
                await asyncio.sleep(3600)
        finally:
            await runner.cleanup()

    try:
        loop.run_until_complete(_serve())
    except KeyboardInterrupt:
        print("\n 已停止。")
    finally:
        loop.close()