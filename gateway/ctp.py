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

# 默认订阅合约（可改成配置项；注意按季度换月）
DEFAULT_SYMBOLS = [
    "rb2510", "cu2507", "au2512", "ag2512",
    "sc2507", "IF2507", "m2509", "i2509",
]


class MdSpi(mdapi.CThostFtdcMdSpi):
    """行情回调实现。每个账号一个实例。"""

    def __init__(self, gw):
        super().__init__()
        self._gw = gw
        self._api = None

    def create_api(self, flow_dir):
        os.makedirs(flow_dir, exist_ok=True)
        self._api = mdapi.CThostFtdcMdApi.CreateFtdcMdApi(flow_dir)
        self._api.RegisterFront(self._gw.md_front)
        self._api.RegisterSpi(self)
        self._api.Init()

    def OnFrontConnected(self):
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "connecting", "msg": "行情前置已连接，登录中…"})
        req = mdapi.CThostFtdcReqUserLoginField()
        self._api.ReqUserLogin(req, 0)

    def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            self._gw.emit({"type": "login", "account": self._gw.name, "status": "fail", "msg": f"行情登录失败：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})
            return
        self._gw.md_logged_in = True
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "md_ok", "msg": "行情连接就绪"})
        self._gw.subscribe(self._gw.md_symbols)

    def OnRtnDepthMarketData(self, pDepthMarketData):
        tick = {
            "type": "tick",
            "account": self._gw.name,
            "symbol": pDepthMarketData.InstrumentID,
            "price": pDepthMarketData.LastPrice,
            "pre_close": pDepthMarketData.PreClosePrice,
            "open": pDepthMarketData.OpenPrice,
            "high": pDepthMarketData.HighestPrice,
            "low": pDepthMarketData.LowestPrice,
            "volume": pDepthMarketData.Volume,
            "bid1": pDepthMarketData.BidPrice1, "bidv1": pDepthMarketData.BidVolume1,
            "bid2": pDepthMarketData.BidPrice2, "bidv2": pDepthMarketData.BidVolume2,
            "bid3": pDepthMarketData.BidPrice3, "bidv3": pDepthMarketData.BidVolume3,
            "bid4": pDepthMarketData.BidPrice4, "bidv4": pDepthMarketData.BidVolume4,
            "bid5": pDepthMarketData.BidPrice5, "bidv5": pDepthMarketData.BidVolume5,
            "ask1": pDepthMarketData.AskPrice1, "askv1": pDepthMarketData.AskVolume1,
            "ask2": pDepthMarketData.AskPrice2, "askv2": pDepthMarketData.AskVolume2,
            "ask3": pDepthMarketData.AskPrice3, "askv3": pDepthMarketData.AskVolume3,
            "ask4": pDepthMarketData.AskPrice4, "askv4": pDepthMarketData.AskVolume4,
            "ask5": pDepthMarketData.AskPrice5, "askv5": pDepthMarketData.AskVolume5,
        }
        self._gw.emit(tick)

    def OnRspSubMarketData(self, pSpecificInstrument, pRspInfo, nRequestID, bIsLast):
        if pRspInfo and pRspInfo.ErrorID != 0:
            sym = ""
            try:
                sym = pSpecificInstrument.InstrumentID
            except Exception:
                pass
            self._gw.emit({"type": "error", "account": self._gw.name, "msg": f"订阅行情失败 {sym}：{pRspInfo.ErrorMsg} ({pRspInfo.ErrorID})"})

    def OnFrontDisconnected(self, nReason):
        self._gw.emit({"type": "login", "account": self._gw.name, "status": "disconnected", "msg": f"行情前置断开 ({nReason})"})


class TraderSpi(tdapi.CThostFtdcTraderSpi):
    """交易回调实现。"""

    def __init__(self, gw):
        super().__init__()
        self._gw = gw
        self._api = None

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
        self._gw.after_login()

    # ---- 资金 ----
    def OnRspQryTradingAccount(self, pAccount, pRspInfo, nRequestID, bIsLast):
        if pAccount is None:
            return
        self._gw.emit({
            "type": "balance",
            "account": self._gw.name,
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
        if pPosition is None:
            return
        self._gw.emit({
            "type": "position",
            "account": self._gw.name,
            "symbol": pPosition.InstrumentID,
            "direction": pPosition.PosiDirection,   # 多/空
            "volume": pPosition.Position,
            "today_volume": pPosition.TodayPosition,
            "avail": pPosition.PositionAvailable,
            "open_price": pPosition.OpenCostPrice,
            "margin": pPosition.UseMargin,
            "position_profit": pPosition.PositionProfit,
            "close_volume": pPosition.CloseVolume,
            "is_last": bIsLast,
        })

    # ---- 报单回报 ----
    def OnRtnOrder(self, pOrder):
        self._gw.emit({
            "type": "order",
            "account": self._gw.name,
            "order_ref": getattr(pOrder, "OrderRef", ""),
            "order_sys_id": getattr(pOrder, "OrderSysID", ""),
            "symbol": pOrder.InstrumentID,
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
        self._gw.emit({
            "type": "trade",
            "account": self._gw.name,
            "order_sys_id": getattr(pTrade, "OrderSysID", ""),
            "symbol": pTrade.InstrumentID,
            "direction": pTrade.Direction,
            "offset": getattr(pTrade, "OffsetFlag", ""),
            "price": pTrade.Price,
            "volume": pTrade.Volume,
            "time": getattr(pTrade, "TradeTime", ""),
        })

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
        self.user_id = acc_cfg["user_id"]
        self.password = acc_cfg["password"]
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

    def after_login(self):
        self.query_balance()
        self.query_positions()
        self.query_orders()

    def query_balance(self):
        if self.trader:
            self.trader.ReqQryTradingAccount(tdapi.CThostFtdcQryTradingAccountField(), 0)

    def query_positions(self):
        if self.trader:
            req = tdapi.CThostFtdcQryInvestorPositionField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryInvestorPosition(req, 0)

    def query_orders(self):
        if self.trader:
            req = tdapi.CThostFtdcQryOrderField()
            req.BrokerID = self.broker_id
            req.InvestorID = self.user_id
            self.trader.ReqQryOrder(req, 0)

    def subscribe(self, symbols):
        """行情登录后订阅。symbols 为字符串列表。"""
        self.md_symbols = list(symbols)
        if not self.md or not self.md_logged_in:
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
        f.CombOffsetFlag = tdapi.THOST_FTDC_OF_Open if offset == "open" else tdapi.THOST_FTDC_OF_Close
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