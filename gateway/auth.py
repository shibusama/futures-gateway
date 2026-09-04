# -*- coding: utf-8 -*-
"""站点访问鉴权：单口令登录 + 内存会话，用于把网关暴露到公网（如 Cloudflare Tunnel）时挡住陌生人。

原则：
- 不建用户数据库。单人终端只需一个站点口令，密码经 PBKDF2-SHA256 加盐哈希后存 config.json，
  绝不落明文。
- 会话存在内存（进程内 dict），服务重启即全部失效（需重新登录），对单人场景足够且简单。
- 会话 Cookie 置 HttpOnly + SameSite=Lax，前端 JS 读不到，只有浏览器在每次请求/握手时自动携带。
"""
import hashlib
import hmac
import secrets
import time

from aiohttp import web

COOKIE_NAME = "ft_session"
SESSION_TTL_SEC = 7 * 24 * 3600  # 7 天，保持登录态
MAX_FAIL_PER_IP = 5              # 每来源 IP 每分钟最多失败的登录尝试
FAIL_WINDOW_SEC = 60
PBKDF2_ITER = 120_000


def hash_password(password: str, salt: str) -> str:
    """PBKDF2-SHA256 -> hex。salt 已含在结果判断中（单独字段）。"""
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITER
    ).hex()


def make_site_auth(password: str) -> dict:
    """为给定明文密码生成 {salt, hash} 存储结构。"""
    salt = secrets.token_hex(16)
    return {"salt": salt, "hash": hash_password(password, salt)}


def verify_site_auth(stored: dict | None, password: str) -> bool:
    """校验明文密码是否匹配 config 中存储的 salt+hash。没有配置/缺字段一律拒绝。"""
    if not stored or not password:
        return False
    salt = stored.get("salt") or ""
    digest = stored.get("hash") or ""
    if not salt or not digest:
        return False
    # 用 hmac.compare_digest 做常量时间比较，避免时序侧信道
    return hmac.compare_digest(hash_password(password, salt), digest)


def generate_password(length: int = 16) -> str:
    """生成便于手工输入但不含易混字符(0O1lI)的强口令。"""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
    # 保证至少一个符号，避免太单调
    return secrets.choice("!@#$%^&*-_") + "".join(secrets.choice(alphabet) for _ in range(length - 1))


# 视为"本机访问"的 Host 值（去掉端口后比较）。命中则不要求口令，
# 让本地桌面/浏览器保持无密码；只有经隧道/LAN 等非本机域名访问时才要登录。
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class SiteAuth:
    """把配置里的 site_auth 接进 aiohttp：判断是否本机访问、校验会话、签发 Cookie。

    关键背景：cloudflared 隧道把外网请求在本机转给网关，所以网关看到的来源 IP
    一律是 127.0.0.1，无法靠 IP 区分内外。真正可靠的信号是请求的 Host：
    - Host = 127.0.0.1 / localhost / ::1  → 本机直接访问，视为可信，无需口令；
    - 其他 Host（如 xxx.trycloudflare.com、局域网 IP）→ 要求先登录。
    """

    def __init__(self, site_auth: dict | None) -> None:
        self.sessions = SessionStore()
        self.site_auth = site_auth

    @property
    def enabled(self) -> bool:
        """只有配置里写明了盐+哈希才启用；否则完全放行（保持旧行为）。"""
        return bool(self.site_auth and (self.site_auth.get("salt")) and (self.site_auth.get("hash")))

    def host_is_local(self, request) -> bool:
        try:
            host = (request.host or "").strip().lower()
        except Exception:
            host = ""
        if not host:
            return False
        if host.startswith("["):  # [::1]:8765
            core = host[1:].split("]", 1)[0]
        elif host.count(":") == 1:  # 127.0.0.1:8765 / localhost:8765
            core = host.split(":", 1)[0]
        else:  # 无端口主机名，或裸 IPv6（::1）
            core = host
        return core in LOCAL_HOSTS

    def client_ip(self, request) -> str:
        """隧道后拿不到真实远端 IP，用 Cloudflare 注入的头近似（仅用于限速）。"""
        ip = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
        if ip:
            return ip.split(",")[0].strip()
        return request.remote or "unknown"

    def is_authorized(self, request) -> bool:
        """本机访问直接放行；否则要求有效会话 Cookie。"""
        if not self.enabled or self.host_is_local(request):
            return True
        return self.sessions.valid(request.cookies.get(COOKIE_NAME))

    def cookie_token(self, request) -> str | None:
        return request.cookies.get(COOKIE_NAME)

    def attach_session(self, response: web.Response) -> None:
        token = self.sessions.create()
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_TTL_SEC,
            httponly=True,
            samesite="Lax",
            path="/",
        )

    def detach_session(self, request, response: web.Response) -> None:
        self.sessions.revoke(self.cookie_token(request))
        response.del_cookie(COOKIE_NAME, path="/")


class SessionStore:
    """进程内会话表：token -> {created_at, expires_at}。HttpOnly Cookie 只存 token。"""

    def __init__(self) -> None:
        self._sessions: dict[str, dict] = {}
        self._fail: dict[str, list[float]] = {}

    def create(self) -> str:
        self._gc()
        token = secrets.token_urlsafe(32)
        now = time.time()
        self._sessions[token] = {"created_at": now, "expires_at": now + SESSION_TTL_SEC}
        return token

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        s = self._sessions.get(token)
        if not s:
            return False
        if time.time() > s["expires_at"]:
            self._sessions.pop(token, None)
            return False
        return True

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)

    def _gc(self) -> None:
        now = time.time()
        for token in [t for t, s in self._sessions.items() if now > s["expires_at"]]:
            self._sessions.pop(token, None)

    def record_failure(self, ip: str) -> None:
        now = time.time()
        arr = [t for t in self._fail.get(ip, []) if now - t < FAIL_WINDOW_SEC]
        arr.append(now)
        self._fail[ip] = arr

    def clear_failures(self, ip: str) -> None:
        self._fail.pop(ip, None)

    def is_blocked(self, ip: str) -> bool:
        now = time.time()
        arr = [t for t in self._fail.get(ip, []) if now - t < FAIL_WINDOW_SEC]
        self._fail[ip] = arr
        return len(arr) >= MAX_FAIL_PER_IP
