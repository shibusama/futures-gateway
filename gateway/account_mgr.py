# -*- coding: utf-8 -*-
"""多账号管理器：持有所有 CTP 连接，统一把事件推送给所有已连接的 WebSocket 客户端。"""
import asyncio
import json
import threading

from .ctp import CtpGateway, DEFAULT_SYMBOLS


class AccountManager:
    def __init__(self, config: dict):
        self.config = config
        self.gateways = {}          # account_name -> CtpGateway
        self.clients = set()        # 已连接的 WebSocket 客户端集合
        self.loop = asyncio.get_event_loop()
        self._lock = threading.Lock()
        self.last_states = {}       # account_name -> {'login': ..., 'balance': {...}}

    # ---------- WebSocket 客户端管理 ----------
    def add_client(self, ws):
        with self._lock:
            self.clients.add(ws)

    def remove_client(self, ws):
        with self._lock:
            self.clients.discard(ws)

    def client_count(self):
        with self._lock:
            return len(self.clients)

    # ---------- 事件上抛 ----------
    def on_gateway_event(self, event: dict):
        """CTP 回调线程调用 → 转投到 asyncio 主循环 → 广播 + 缓存。"""
        acc = event.get("account")
        if event.get("type") == "login":
            self.last_states.setdefault(acc, {})["login"] = event.get("status")
        if event.get("type") == "balance":
            self.last_states.setdefault(acc, {})["balance"] = event
        try:
            self.loop.call_soon_threadsafe(self._broadcast, event)
        except RuntimeError:
            # 事件循环未启动（例如导入期），忽略
            pass

    def _broadcast(self, event: dict):
        msg = json.dumps(event, ensure_ascii=False)
        for ws in list(self.clients):
            asyncio.ensure_future(self._safe_send(ws, msg))

    @staticmethod
    async def _safe_send(ws, msg: str):
        try:
            await ws.send_str(msg)
        except Exception:
            pass

    # ---------- 连接控制 ----------
    def start(self, symbols=None):
        """启动所有账号的 CTP 连接。"""
        cfg_accounts = self.config.get("accounts", [])
        if not cfg_accounts:
            return {"ok": False, "msg": "config.json 中没有配置账号"}
        if symbols is None:
            symbols = DEFAULT_SYMBOLS
        flow_base = self.config.get("flow_dir", "flow")
        started = []
        for i, acc_cfg in enumerate(cfg_accounts):
            name = acc_cfg.get("name", f"账号{i}")
            flow_dir = f"{flow_base}/{i}/"
            gw = CtpGateway(acc_cfg, self.on_gateway_event, flow_dir)
            self.gateways[name] = gw
            # CTP 在独立线程里跑，避免阻塞 asyncio 循环
            threading.Thread(target=gw.connect, args=(), daemon=True).start()
            # 等行情连接就绪后订阅
            threading.Thread(target=self._subscribe_delay, args=(gw, symbols), daemon=True).start()
            started.append(name)
        return {"ok": True, "started": started}

    @staticmethod
    def _subscribe_delay(gw, symbols):
        import time
        time.sleep(3)  # 等行情连接初始化
        try:
            gw.subscribe(symbols)
        except Exception:
            pass

    # ---------- 指令转发 ----------
    def send_order(self, account: str, symbol: str, direction: str, offset: str, price: float, volume: int):
        gw = self.gateways.get(account)
        if not gw:
            return {"ok": False, "msg": f"未知账户：{account}"}
        return gw.send_order(symbol, direction, offset, price, volume)

    def cancel_order(self, account: str, order_sys_id: str, symbol: str, exchange: str):
        gw = self.gateways.get(account)
        if not gw:
            return {"ok": False, "msg": f"未知账户：{account}"}
        return gw.cancel_order(order_sys_id, symbol, exchange)

    def query_all(self):
        """收到查询请求时，让所有账号重新刷新资金/持仓。"""
        for gw in self.gateways.values():
            gw.query_balance()
            gw.query_positions()
            gw.query_orders()

    def status(self):
        return {
            "accounts": list(self.gateways.keys()),
            "connected_clients": self.client_count(),
            "last_states": self.last_states,
        }