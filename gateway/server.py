# -*- coding: utf-8 -*-
"""aiohttp 服务：静态文件（前端）+ WebSocket（实时数据 / 下单指令）。"""
import asyncio
import json
import mimetypes
import os
import webbrowser

from aiohttp import web

from .config import load_config
from .history import fetch_bars

from app_paths import bundle_root

mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".mjs")


def web_dir() -> str:
    bundled = os.path.join(bundle_root(), "web")
    if os.path.isdir(bundled):
        return bundled
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


WEB_DIR = web_dir()


def build_app(mgr):
    app = web.Application()
    app["mgr"] = mgr

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
                elif cmd == "order":
                    result = mgr.send_order(
                        account=payload.get("account"),
                        symbol=payload.get("symbol"),
                        direction=payload.get("direction"),
                        offset=payload.get("offset"),
                        price=float(payload.get("price", 0)),
                        volume=int(payload.get("volume", 0)),
                    )
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
    app = build_app(mgr)
    host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))

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