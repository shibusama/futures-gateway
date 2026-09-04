# -*- coding: utf-8 -*-
"""config.normalize 等纯函数测试（避免触碰真实 config.json）。"""
import unittest

from gateway.config import DEFAULT_CONFIG, normalize


class NormalizeTest(unittest.TestCase):
    def test_fills_missing_fields(self):
        cfg = normalize({})
        self.assertEqual(cfg["host"], "127.0.0.1")
        self.assertEqual(cfg["port"], 8765)
        self.assertEqual(cfg["accounts"], [])
        self.assertEqual(cfg["site_auth"], None)

    def test_account_fields_stripped_and_defaulted(self):
        cfg = normalize({"accounts": [{"name": "  t  ", "user_id": " 123 ",
                                       "password": " pwd ", "trade_front": "x"}]})
        acc = cfg["accounts"][0]
        self.assertEqual(acc["user_id"], "123")
        self.assertEqual(acc["password"], "pwd")
        self.assertEqual(acc["name"], "  t  ")  # name 保持原样（不 trim）
        self.assertEqual(acc["broker_id"], "9999")
        self.assertEqual(acc["account_type"], "simnow")
        self.assertTrue(acc["md_front"])

    def test_default_config_wellformed(self):
        cfg = normalize(dict(DEFAULT_CONFIG))
        self.assertEqual(len(cfg["accounts"]), 1)
        self.assertIn("user_id", cfg["accounts"][0])


if __name__ == "__main__":
    unittest.main()
