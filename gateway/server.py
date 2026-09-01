# -*- coding: utf-8 -*-
"""aiohttp 服务：静态文件（前端）+ WebSocket（实时数据 / 下单指令）。"""
import asyncio
import json
import os

from aiohttp import web

from .config import load_config
from .history import fetch_bars

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def build_app(mgr):
    app = web.Application()
    app["mgr"] = mgr

    # 静态前端
    app.router.add_get("/api/bars", bars_handler)
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/", WEB_DIR, show_index=True)

    return app


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
        print(f"  服务已启动: http://{host}:{port}  （Ctrl+C 停止）")
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