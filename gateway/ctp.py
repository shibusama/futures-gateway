# -*- coding: utf-8 -*-
"""
CTP 连接封装（基于 openctp-ctp：标准 CTP API 的 Python 直译，pip install openctp-ctp）。

一个 CtpGateway 实例 = 一个资金账号（一个交易连接 + 一个行情连接）。
事件通过回调 on_event(event_dict) 上抛给上层（AccountManager / WebSocket 推送）。

事件字典统一格式：
    {"type": "login", "account": name, "status": True/False/"connecting", "msg": ...}
    {"type": "tick",   "account": name, "symbol": code, "price": ..., "bid1": ..., "ask1": ..., ...}
    {"type": "position", "account": name, ...}
    {"type": "trade",   "account": name, ...}
    {"type": "order",   "account": name, ...}
    {"type": "balance", "account": name, ...}

与 vnpy_ctp 版本的差异：openctp 是标准 CTP API 直译，类名 CThostFtdc*，需 SPI 继承。
"""
import threading
import os

from openctp_ctp import thosttraderapi as tdapi
from openctp_ctp import thostmduserapi as mdapi

# SimNow 仿真的认证凭据（固定，见仓库 demo）
SIMNOW_APPID = "simnow_client_test"
SIMNOW_AUTHCODE = "0000000000000000"

# 默认订阅合约（SimNow 当前主力月 2026-08；注意随季度换月更新）
DEFAULT_SYMBOLS = [
    "rb2610", "cu2611", "au2612", "ag2612",
    "sc2609", "IF2609", "m2609", "i2609",
]


class MdSpi(mdapi.CThostFtdcMdSpi):
    """行情回调实现。每个账号一个实例。"""

    def __init__(self, gw):
        super().__init__()
        self._gw = gw
        self._account = gw.name
        self._emit = gw.emit
        self._api = None

    def _safe_emit(self, event: dict) -> None:
        emit = getattr(self, "_emit", None)
        if emit is None:
            gw = getattr(self, "_gw", None)
            emit = gw.emit if gw is not None else None
        if emit is not None:
            emit(event)

    def create_api(self, flow_dir):
        os.makedirs(flow_dir, exist_ok=True)
        self._api = mdapi.CThostFtdcMdApi.CreateFtdcMdApi(flow_dir)
        self._api.RegisterFront(self._gw.md_front)
        self._api.RegisterSpi(self)
        self._api.Init()

    def OnFrontConnected(self):
        self._safe_emit({"type": "login", "account": self._account, "status": "connecting", "msg": "行情前置已连接，登录中…"})
        req = mdapi.CThostFtdcReqUserLoginField()
        self._api.ReqUserLogin(req, 0)

    def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._safe_emit({"type": "login", "account": self._account, "status": "fail", "msg": f"行情登录失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})
            return
        gw = getattr(self, "_gw", None)
        if gw is not None:
            gw.md_logged_in = True
        self._safe_emit({"type": "login", "account": self._account, "status": "md_ok", "msg": "行情连接就绪"})
        if gw is not None:
            gw._do_subscribe()

    def OnRtnDepthMarketData(self, pDepthMarketData):
        if not getattr(self, "_emit", None) and not getattr(self, "_gw", None):
            return
        import time as _t
        # 组装时间戳（毫秒，用于前端 K 线聚合；优先用 CTP 行情时间）
        ts = None
        try:
            ut = getattr(pDepthMarketData, "UpdateTime", "") or ""
            if ":" in ut:
                import datetime as _dt
                nowd = _dt.datetime.now()
                h, m, s = ut.split(":")
                ts = int(nowd.replace(hour=int(h), minute=int(m), second=int(s), microsecond=0).timestamp() * 1000)
        except Exception:
            ts = None
        if ts is None:
            ts = int(_t.time() * 1000)

        # 净化盘口价格：CTP 无效档位返回 ~1.797e308 或超大值，统一置为 None 避免前端显示天文数字
        def clean_price(v):
            try:
                if v is None:
                    return None
                v = float(v)
                if v <= 0 or v > 1e7:  # 价格不可能超过 1e7（每手），无效档位过滤
                    return None
                return v
            except Exception:
                return None

        def clean_vol(v):
            try:
                v = int(v)
                return v if v > 0 else 0
            except Exception:
                return 0

        tick = {
            "type": "tick",
            "account": self._account,
            "symbol": pDepthMarketData.InstrumentID,
            "price": pDepthMarketData.LastPrice,
            "pre_close": clean_price(pDepthMarketData.PreClosePrice),
            "open": clean_price(pDepthMarketData.OpenPrice),
            "high": clean_price(pDepthMarketData.HighestPrice),
            "low": clean_price(pDepthMarketData.LowestPrice),
            "volume": pDepthMarketData.Volume,
            "_ts": ts,
            "bid1": clean_price(pDepthMarketData.BidPrice1), "bidv1": clean_vol(pDepthMarketData.BidVolume1),
            "bid2": clean_price(pDepthMarketData.BidPrice2), "bidv2": clean_vol(pDepthMarketData.BidVolume2),
            "bid3": clean_price(pDepthMarketData.BidPrice3), "bidv3": clean_vol(pDepthMarketData.BidVolume3),
            "bid4": clean_price(pDepthMarketData.BidPrice4), "bidv4": clean_vol(pDepthMarketData.BidVolume4),
            "bid5": clean_price(pDepthMarketData.BidPrice5), "bidv5": clean_vol(pDepthMarketData.BidVolume5),
            "ask1": clean_price(pDepthMarketData.AskPrice1), "askv1": clean_vol(pDepthMarketData.AskVolume1),
            "ask2": clean_price(pDepthMarketData.AskPrice2), "askv2": clean_vol(pDepthMarketData.AskVolume2),
            "ask3": clean_price(pDepthMarketData.AskPrice3), "askv3": clean_vol(pDepthMarketData.AskVolume3),
            "ask4": clean_price(pDepthMarketData.AskPrice4), "askv4": clean_vol(pDepthMarketData.AskVolume4),
            "ask5": clean_price(pDepthMarketData.AskPrice5), "askv5": clean_vol(pDepthMarketData.AskVolume5),
        }
        self._safe_emit(tick)

    def OnRspSubMarketData(self, pSpecificInstrument, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            sym = ""
            try:
                sym = pSpecificInstrument.InstrumentID
            except Exception:
                pass
            self._safe_emit({"type": "error", "account": self._account, "msg": f"订阅行情失败 {sym}：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})

    def OnFrontDisconnected(self, nReason):
        self._safe_emit({"type": "login", "account": self._account, "status": "disconnected", "msg": f"行情前置断开 ({nReason})"})


class TraderSpi(tdapi.CThostFtdcTraderSpi):
    """交易回调实现。"""

    def __init__(self, gw):
        super().__init__()
        self._gw = gw
        self._account = gw.name
        self._emit = gw.emit
        self._api = None

    def _safe_emit(self, event: dict) -> None:
        emit = getattr(self, "_emit", None)
        if emit is None:
            gw = getattr(self, "_gw", None)
            emit = gw.emit if gw is not None else None
        if emit is not None:
            emit(event)

    def create_api(self, flow_dir):
        os.makedirs(flow_dir, exist_ok=True)
        self._api = tdapi.CThostFtdcTraderApi.CreateFtdcTraderApi(flow_dir)
        self._api.RegisterFront(self._gw.trade_front)
        self._api.RegisterSpi(self)
        try:
            self._api.SubscribePrivateTopic(tdapi.THOST_TERT_QUICK)
            self._api.SubscribePublicTopic(tdapi.THOST_TERT_QUICK)
        except Exception:
            pass
        self._api.Init()

    def OnFrontConnected(self):
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "connecting", "msg": "交易前置已连接，认证中…"})
        self._authenticate()

    def OnFrontDisconnected(self, nReason):
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "disconnected", "msg": f"交易前置断开 ({nReason})"})

    def _authenticate(self):
        req = tdapi.CThostFtdcReqAuthenticateField()
        req.BrokerID = self._gw.broker_id
        req.UserID = self._gw.user_id
        req.AppID = SIMNOW_APPID
        req.AuthCode = SIMNOW_AUTHCODE
        self._api.ReqAuthenticate(req, 0)

    def OnRspAuthenticate(self, pRspAuth, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({"type": "login", "account": self._gw.name, "status": "fail", "msg": f"认证失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})
            return
        self._login()

    def _login(self):
        req = tdapi.CThostFtdcReqUserLoginField()
        req.BrokerID = self._gw.broker_id
        req.UserID = self._gw.user_id
        req.Password = self._gw.password
        if os.name == "posix" and sys.platform == "darwin":
            self._api.ReqUserLogin(req, 0, 0, "")
        else:
            self._api.ReqUserLogin(req, 0)

    def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({"type": "login", "account": self._gw.name, "status": "fail", "msg": f"登录失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})
            return
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "ok", "msg": "登录成功"})
        self._confirm_settlement()
        # 结算确认回调里再查资金；若前置不回调，4 秒后兜底刷新
        self._gw._schedule_post_login_refresh()

    def _confirm_settlement(self):
        """CTP 登录后需确认结算单，否则资金/持仓查询经常为空。"""
        try:
            req = tdapi.CThostFtdcSettlementInfoConfirmField()
            req.BrokerID = self._gw.broker_id
            req.InvestorID = self._gw.user_id
            self._api.ReqSettlementInfoConfirm(req, self._gw._next_req_id())
        except Exception:
            pass

    def OnRspSettlementInfoConfirm(self, pConfirm, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({
                "type": "error",
                "account": self._gw.name,
                "msg": f"结算确认失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})",
            })
            return
        if bIsLast:
            self._gw.after_login()

    # ---- 资金 ----
    def OnRspQryTradingAccount(self, pAccount, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({
                "type": "error",
                "account": self._gw.name,
                "msg": f"资金查询失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})",
            })
            return
        if pAccount is None:
            return
        bal = float(getattr(pAccount, "Balance", 0) or 0)
        self._gw._mark_balance_received(bal > 0 or bal == 0)
        self._gw.emit({
            "type": "balance",
            "account": self._gw.name,
            "account_id": self._gw.user_id,
            "balance": pAccount.Balance,
            "available": pAccount.Available,
            "margin": pAccount.CurrMargin,
            "position_profit": pAccount.PositionProfit,
            "close_profit": pAccount.CloseProfit,
            "commission": pAccount.Commission,
            "withdraw": pAccount.WithdrawQuota,
        })

    # ---- 持仓 ----
    def OnRspQryInvestorPosition(self, pPosition, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({
                "type": "error",
                "account": self._gw.name,
                "msg": f"持仓查询失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})",
            })
            return
        if pPosition is None:
            return
        try:
            # PosiDirection: '2'=多, '3'=空
            raw_dir = str(getattr(pPosition, "PosiDirection", "") or "")
            direction = "Long" if raw_dir.endswith("2") else "Short"
            posi_dir = 2 if direction == "Long" else 3
            volume = int(pPosition.Position)
            if volume <= 0:
                volume = int(pPosition.YdPosition)
            if volume <= 0:
                return
            # 可平数量 = 总持仓 - 冻结
            frozen = int(pPosition.LongFrozen if posi_dir == 2 else pPosition.ShortFrozen)
            today_vol = int(pPosition.TodayPosition)
            yd_vol = int(pPosition.YdPosition)
            today_frozen = min(frozen, today_vol) if today_vol > 0 else 0
            yd_frozen = max(0, frozen - today_frozen)
            avail = max(0, volume - frozen)
            position_cost = float(getattr(pPosition, "PositionCost", 0) or 0)
            open_cost = float(getattr(pPosition, "OpenCost", 0) or 0)
            if position_cost > 0:
                open_price = position_cost / volume
            elif open_cost > 0:
                open_price = open_cost / volume
            else:
                open_price = float(getattr(pPosition, "PreSettlementPrice", 0) or 0)
            self._gw.emit({
                "type": "position",
                "account": self._gw.name,
                "symbol": pPosition.InstrumentID,
                "direction": direction,
                "volume": volume,
                "today_volume": int(pPosition.TodayPosition),
                "yd_volume": int(pPosition.YdPosition),
                "frozen": frozen,
                "today_frozen": today_frozen,
                "yd_frozen": yd_frozen,
                "avail": avail,
                "open_price": open_price,
                "margin": float(pPosition.UseMargin),
                "position_profit": float(pPosition.PositionProfit),
                "close_profit": float(pPosition.CloseProfit),
                "close_volume": int(pPosition.CloseVolume),
                "exchange": pPosition.ExchangeID,
                "is_last": bIsLast,
            })
        except Exception as exc:
            self._gw.emit({
                "type": "error",
                "account": self._gw.name,
                "msg": f"持仓解析失败：{exc}",
            })

    # ---- 报单回报 ----
    def OnRtnOrder(self, pOrder):
        self._gw.emit({
            "type": "order",
            "account": self._gw.name,
            "order_ref": getattr(pOrder, "OrderRef", ""),
            "order_sys_id": getattr(pOrder, "OrderSysID", ""),
            "symbol": pOrder.InstrumentID,
            "exchange": getattr(pOrder, "ExchangeID", "") or CtpGateway._exchange_of(pOrder.InstrumentID),
            "direction": getattr(pOrder, "Direction", ""),
            "offset": getattr(pOrder, "CombOffsetFlag", "")[:1] if getattr(pOrder, "CombOffsetFlag", "") else "",
            "limit_price": pOrder.LimitPrice,
            "volume_total": pOrder.VolumeTotalOriginal,
            "volume_traded": pOrder.VolumeTraded,
            "status": pOrder.OrderStatus,
            "status_msg": getattr(pOrder, "StatusMsg", ""),
            "time": getattr(pOrder, "InsertTime", ""),
        })

    def OnRtnTrade(self, pTrade):
        self._emit_trade(pTrade)

    def _emit_trade(self, pTrade):
        self._gw.emit({
            "type": "trade",
            "account": self._gw.name,
            "trade_id": getattr(pTrade, "TradeID", ""),
            "order_sys_id": getattr(pTrade, "OrderSysID", ""),
            "symbol": pTrade.InstrumentID,
            "exchange": getattr(pTrade, "ExchangeID", "") or CtpGateway._exchange_of(pTrade.InstrumentID),
            "direction": pTrade.Direction,
            "offset": getattr(pTrade, "OffsetFlag", ""),
            "hedge": getattr(pTrade, "HedgeFlag", "1"),
            "price": pTrade.Price,
            "volume": pTrade.Volume,
            "commission": getattr(pTrade, "Commission", 0),
            "close_profit": getattr(pTrade, "CloseProfit", 0),
            "time": getattr(pTrade, "TradeTime", ""),
            "date": getattr(pTrade, "TradeDate", ""),
        })

    def OnRspQryTrade(self, pTrade, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({
                "type": "error",
                "account": self._gw.name,
                "msg": f"成交查询失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})",
            })
            return
        if pTrade is not None:
            self._emit_trade(pTrade)

    def OnRspOrderInsert(self, pInputOrder, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({"type": "error", "account": self._gw.name, "msg": f"报单被拒：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})

    def OnRspOrderAction(self, pInputOrderAction, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({"type": "error", "account": self._gw.name, "msg": f"撤单失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})


class CtpGateway:
    """一个账号的 CTP 网关封装。"""

    def __init__(self, acc_cfg: dict, emit, flow_dir: str):
        self.name = acc_cfg.get("name", "未命名账号")
        self.user_id = str(acc_cfg["user_id"]).strip()
        self.password = str(acc_cfg["password"]).strip()
        self.broker_id = acc_cfg.get("broker_id", "9999")
        self.trade_front = acc_cfg.get("trade_front", "")
        self.md_front = acc_cfg.get("md_front", "")
        self.emit = emit
        self.flow_dir = flow_dir
        self.trader = None
        self.trader_spi = None
        self.md = None
        self.md_spi = None
        self.md_symbols = list(DEFAULT_SYMBOLS)
        self.md_logged_in = False
        self._req_id = 0
        self._post_login_refresh = False
        self._balance_received = False
        self._refresh_fallback_timer = None

    def _next_req_id(self):
        self._req_id += 1
        return self._req_id

    def _mark_balance_received(self, ok: bool = True) -> None:
        if ok:
            self._balance_received = True

    def _schedule_post_login_refresh(self) -> None:
        if self._refresh_fallback_timer is not None:
            self._refresh_fallback_timer.cancel()
        self._refresh_fallback_timer = threading.Timer(4.0, self.after_login)
        self._refresh_fallback_timer.daemon = True
        self._refresh_fallback_timer.start()

    def refresh_all(self):
        """顺序刷新资金/持仓/委托（CTP 不宜并发查询）。"""
        def _chain():
            import time
            self._balance_received = False
            for attempt in range(6):
                self.query_balance()
                time.sleep(1.5)
                if self._balance_received:
                    break
            time.sleep(0.6)
            self.query_positions()
            time.sleep(0.8)
            self.query_orders()
            time.sleep(0.8)
            self.query_trades()
        threading.Thread(target=_chain, daemon=True).start()

    def after_login(self):
        if self._post_login_refresh:
            self.refresh_all()
            return
        self._post_login_refresh = True
        if self._refresh_fallback_timer is not None:
            self._refresh_fallback_timer.cancel()
            self._refresh_fallback_timer = None
        self.refresh_all()

    def connect(self):
        """建立交易 + 行情连接（各自带线程，不阻塞）。"""
        # 交易连接
        self.trader_spi = TraderSpi(self)
        self.trader_spi.create_api(os.path.join(self.flow_dir, "td"))
        self.trader = self.trader_spi._api

        # 行情连接
        self.md_spi = MdSpi(self)
        self.md_spi.create_api(os.path.join(self.flow_dir, "md"))
        self.md = self.md_spi._api
        # 防止 CTP 回调时 SPI 被 GC 回收
        self._spi_refs = [self.trader_spi, self.md_spi]

    def query_balance(self):
        if self.trader:
            req = tdapi.CThostFtdcQryTradingAccountField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryTradingAccount(req, self._next_req_id())

    def query_positions(self):
        if self.trader:
            req = tdapi.CThostFtdcQryInvestorPositionField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryInvestorPosition(req, self._next_req_id())

    def query_orders(self):
        if self.trader:
            req = tdapi.CThostFtdcQryOrderField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryOrder(req, self._next_req_id())

    def query_trades(self):
        if self.trader:
            req = tdapi.CThostFtdcQryTradeField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryTrade(req, self._next_req_id())

    def subscribe(self, symbols):
        """订阅行情。任何时机调用都安全：
        - 若行情已登录，立即订阅；
        - 若未登录，先记下清单，登录回调里会自动补订。
        """
        self.md_symbols = list(symbols)
        if not self.md or not self.md_logged_in:
            return
        self._do_subscribe()

    def _do_subscribe(self):
        if not self.md:
            return
        encoded = [s.encode("utf-8") for s in self.md_symbols]
        self.md.SubscribeMarketData(encoded, len(encoded))

    # ---- 下单 ----
    def send_order(self, symbol: str, direction: str, offset: str, price: float, volume: int):
        """direction: 'buy'/'sell'; offset: 'open'/'close'。"""
        if not self.trader:
            return {"ok": False, "msg": "交易连接未就绪"}
        f = tdapi.CThostFtdcInputOrderField()
        f.BrokerID = self.broker_id
        f.InvestorID = self.user_id
        f.InstrumentID = symbol
        f.ExchangeID = self._exchange_of(symbol)
        f.Direction = tdapi.THOST_FTDC_D_Buy if direction == "buy" else tdapi.THOST_FTDC_D_Sell
        f.CombOffsetFlag = {
            "open": tdapi.THOST_FTDC_OF_Open,
            "close": tdapi.THOST_FTDC_OF_Close,
            "close_today": tdapi.THOST_FTDC_OF_CloseToday,
            "close_yesterday": tdapi.THOST_FTDC_OF_CloseYesterday,
        }.get(offset, tdapi.THOST_FTDC_OF_Close)
        f.CombHedgeFlag = tdapi.THOST_FTDC_HF_Speculation
        f.LimitPrice = price
        f.VolumeTotalOriginal = volume
        f.OrderPriceType = tdapi.THOST_FTDC_OPT_LimitPrice
        f.TimeCondition = tdapi.THOST_FTDC_TC_GFD
        f.VolumeCondition = tdapi.THOST_FTDC_VC_AV
        f.ContingentCondition = tdapi.THOST_FTDC_CC_Immediately
        f.ForceCloseReason = tdapi.THOST_FTDC_FCC_NotForceClose
        ret = self.trader.ReqOrderInsert(f, 0)
        return {"ok": ret == 0, "msg": "已提交" if ret == 0 else f"报单失败 (ret={ret})"}

    def cancel_order(self, order_sys_id: str, symbol: str, exchange: str):
        if not self.trader:
            return {"ok": False, "msg": "交易连接未就绪"}
        f = tdapi.CThostFtdcInputOrderActionField()
        f.BrokerID = self.broker_id
        f.InvestorID = self.user_id
        f.OrderSysID = order_sys_id
        f.InstrumentID = symbol
        f.ExchangeID = exchange
        f.ActionFlag = tdapi.THOST_FTDC_AF_Delete
        ret = self.trader.ReqOrderAction(f, 0)
        return {"ok": ret == 0, "msg": "撤单已提交" if ret == 0 else f"撤单失败 (ret={ret})"}

    @staticmethod
    def _exchange_of(symbol: str) -> str:
        """根据合约代码前缀推断交易所（顺序敏感）。"""
        if symbol.startswith(("IF", "IH", "IC", "IM")):
            return "CFFEX"
        if symbol.startswith(("sc", "lu", "ec", "nr")):
            return "INE"
        if symbol.startswith(("au", "ag", "cu", "rb", "al", "zn", "ni", "sn", "pb", "ss",
                              "fu", "ru", "bu", "sp", "ao", "bc", "br", "wr")):
            return "SHFE"
        if symbol.startswith(("m", "y", "p", "a", "b", "c", "cs", "jd", "lh", "rr",
                              "l", "v", "pp", "eb", "eg", "pg", "fb", "bb",
                              "i", "j", "jm", "qh")):
            return "DCE"
        if symbol.startswith(("SR", "CF", "TA", "MA", "FG", "ZC", "SA", "UR", "PK",
                              "AP", "CJ", "SF", "SM", "CY", "PF", "SH", "PX")):
            return "CZCE"
        return "SHFE"