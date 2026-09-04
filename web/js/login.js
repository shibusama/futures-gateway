/**
 * login.js — 登录页逻辑：先查会话状态，未登录则提交口令换取会话 Cookie。
 * 成功后跳回 next（仅允许站内相对路径，防开放重定向）。
 */
(function () {
  function qs(key) {
    return new URLSearchParams(location.search).get(key);
  }
  function safeNext() {
    const n = qs("next") || "/";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/";
  }

  const form = document.getElementById("login-form");
  const input = document.getElementById("password");
  const errEl = document.getElementById("login-err");
  const btn = document.getElementById("login-btn");

  function setErr(text, ok) {
    if (!errEl) return;
    errEl.textContent = text || "";
    errEl.className = "login-err" + (ok ? " ok" : "");
  }
  function setBusy(busy) {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? "登录中…" : "进入";
  }

  async function checkSession() {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.status === 404) {
        // 后端未启用鉴权（旧进程）：直接进入
        location.replace(safeNext());
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated) {
          location.replace(safeNext());
          return;
        }
      }
    } catch (_) {
      /* 网关不可达：仍展示表单，提交时会给出明确错误 */
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const password = input.value;
    if (!password) {
      setErr("请输入访问口令。");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 429) {
        setErr("尝试次数过多，请一分钟后再试。");
      } else if (res.ok) {
        setErr("登录成功，正在进入…", true);
        setTimeout(() => location.replace(safeNext()), 150);
      } else {
        let msg = "口令错误。";
        try {
          const j = await res.json();
          if (j && j.msg) msg = j.msg;
        } catch (_) {}
        setErr(msg);
        input.select();
      }
    } catch (_) {
      setErr("无法连接网关，请确认程序已在本机运行。");
    } finally {
      setBusy(false);
    }
  });

  checkSession();
  try {
    input.focus();
  } catch (_) {}
})();
