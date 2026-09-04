# -*- coding: utf-8 -*-
"""CtpGateway.send_order / cancel_order 入参强校验测试。
openctp_ctp 未安装时自动跳过（测试环境无需真实柜台）。"""
import unittest

try:
    from gateway.ctp import CtpGateway
except Exception as exc:  # 缺少 openctp_ctp 等
    CtpGateway = None
    _IMPORT_ERR = exc


class _FakeTrader:
    """捕获 ReqOrderInsert / ReqOrderAction 的入参，不真正发单。"""

    def __init__(self):
        self.last_insert = None
        self.last_action = None

    def ReqOrderInsert(self, field, request_id):
        self.last_insert = field
        return 0

    def ReqOrderAction(self, field, request_id):
        self.last_action = field
        return 0


@unittest.skipIf(CtpGateway is None, "openctp_ctp 未安装，跳过 CTP 校验测试")
class CtpValidationTest(unittest.TestCase):
    def setUp(self):
        self.gw = CtpGateway(
            {"name": "t", "user_id": "123456", "password": "p",
             "broker_id": "9999", "trade_front": "tcp://x", "md_front": "tcp://x"},
            emit=lambda _d: None,
            flow_dir="flow",
        )
        self.trader = _FakeTrader()
        self.gw.trader = self.trader

    def test_invalid_direction_rejected(self):
        r = self.gw.send_order("rb2610", "buyy", "open", 3500, 1)
        self.assertFalse(r["ok"])
        self.assertIn("非法方向", r["msg"])

    def test_invalid_offset_rejected(self):
        r = self.gw.send_order("rb2610", "buy", "whatever", 3500, 1)
        self.assertFalse(r["ok"])
        self.assertIn("非法开平", r["msg"])

    def test_bad_symbol_rejected(self):
        r = self.gw.send_order("rb-2610;rm -rf", "buy", "open", 3500, 1)
        self.assertFalse(r["ok"])
        self.assertIn("合约代码非法", r["msg"])

    def test_bad_price_volume_rejected(self):
        self.assertIn("格式非法", self.gw.send_order("rb2610", "buy", "open", "abc", 1)["msg"])
        self.assertIn("委托价格非法", self.gw.send_order("rb2610", "buy", "open", 0, 1)["msg"])
        self.assertIn("手数非法", self.gw.send_order("rb2610", "buy", "open", 3500, 0)["msg"])
        self.assertIn("手数非法", self.gw.send_order("rb2610", "buy", "open", 3500, 2000)["msg"])

    def test_valid_order_passes_fields_to_ctp(self):
        r = self.gw.send_order("rb2610", "buy", "open", 3500.0, 2)
        self.assertTrue(r["ok"])
        f = self.trader.last_insert
        self.assertIsNotNone(f)
        self.assertEqual(f.InstrumentID, "rb2610")
        self.assertEqual(f.LimitPrice, 3500.0)
        self.assertEqual(f.VolumeTotalOriginal, 2)

    def test_cancel_requires_id_and_derives_exchange(self):
        r = self.gw.cancel_order("", "rb2610", "")
        self.assertFalse(r["ok"])
        self.assertIn("order_sys_id", r["msg"])
        r = self.gw.cancel_order("SYS1", "rb2610", "")
        self.assertTrue(r["ok"])
        f = self.trader.last_action
        self.assertEqual(f.ExchangeID, "SHFE")
        self.assertEqual(f.OrderSysID, "SYS1")


if __name__ == "__main__":
    unittest.main()
