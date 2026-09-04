/**
 * auth.js — 会话守卫：询问网关当前是否已通过鉴权。
 * 约定：
 *   服务器仅在“非本机 Host + 无有效会话 Cookie”时返回 authenticated=false。
 *   本机访问(127.0.0.1/localhost)、离线/本地无网关时都视为放行，不打扰本地开发。
 * 返回 false 表示已跳转到登录页（调用方应停止后续初始化）。
 */
export async function ensureSession({ next } = {}) {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    return true; // file:// 本地预览等，直接放行
  }
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (res.status === 404) {
      // 后端还没带 /api/session（旧进程/未升级）：视为鉴权未启用，放行
      return true;
    }
    if (!res.ok) return false;
    const data = await res.json();
    if (data && data.authenticated) return true;
  } catch (_) {
    return true; // 网关不可达（本地/离线），放行让页面自行处理连接状态
  }
  const dest = next || location.pathname + location.search || "/";
  const safeNext = dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
  location.replace(`/login.html?next=${encodeURIComponent(safeNext)}`);
  return false;
}
