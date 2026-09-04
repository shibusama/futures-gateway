# -*- coding: utf-8 -*-
"""auth 口令哈希与本机判定单元测试（纯标准库）。运行：python -m unittest discover -s backend_tests"""
import unittest

from gateway.auth import (
    COOKIE_NAME,
    make_site_auth,
    verify_site_auth,
    SiteAuth,
)


class _FakeReq:
    def __init__(self, host, cookies=None):
        self.host = host
        self.cookies = cookies or {}


class AuthHashTest(unittest.TestCase):
    def test_make_and_verify(self):
        stored = make_site_auth("s3cret")
        self.assertTrue(stored["salt"])
        self.assertTrue(stored["hash"])
        self.assertNotIn("s3cret", stored["hash"])
        self.assertTrue(verify_site_auth(stored, "s3cret"))
        self.assertFalse(verify_site_auth(stored, "wrong"))

    def test_missing_stored_rejected(self):
        self.assertFalse(verify_site_auth(None, "x"))
        self.assertFalse(verify_site_auth({}, "x"))


class HostLocalTest(unittest.TestCase):
    def test_local_hosts(self):
        sa = SiteAuth(None)
        self.assertTrue(sa.host_is_local(_FakeReq("127.0.0.1:8765")))
        self.assertTrue(sa.host_is_local(_FakeReq("localhost:8765")))
        self.assertTrue(sa.host_is_local(_FakeReq("[::1]:8765")))
        self.assertTrue(sa.host_is_local(_FakeReq("::1")))
        self.assertFalse(sa.host_is_local(_FakeReq("abc.trycloudflare.com")))
        self.assertFalse(sa.host_is_local(_FakeReq("192.168.1.5:8765")))

    def test_enabled_requires_cookie_for_remote_host(self):
        stored = make_site_auth("pw")
        sa = SiteAuth({"salt": stored["salt"], "hash": stored["hash"]})
        self.assertTrue(sa.enabled)
        # 非本机 host：无 cookie 拒绝；本机 host：放行
        self.assertFalse(sa.is_authorized(_FakeReq("evil.example.com")))
        self.assertTrue(sa.is_authorized(_FakeReq("127.0.0.1:8765")))
        # 有会话 cookie 放行
        token = sa.sessions.create()
        self.assertTrue(sa.is_authorized(_FakeReq("evil.example.com", {COOKIE_NAME: token})))

    def test_disabled_always_allows(self):
        sa = SiteAuth(None)
        self.assertFalse(sa.enabled)
        self.assertTrue(sa.is_authorized(_FakeReq("evil.example.com")))


if __name__ == "__main__":
    unittest.main()
