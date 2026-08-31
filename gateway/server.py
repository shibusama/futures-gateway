# -*- coding: utf-8 -*-
"""aiohttp 服务：静态文件（前端）+ WebSocket（实时数据 / 下单指令）。"""
import json
import os

from aiohttp import web

from .config import load_config

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def build_app(mgr):
    app = web.Application()
    app["mgr"] = mgr

    # 静态前端
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/", WEB_DIR, show_index=True)

    return app


async def index_handler(request):
    return web.FileResponse(os.path.join(WEB_DIR, "index.html"))


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
    web.run_app(app, host=host, port=port, print=None)