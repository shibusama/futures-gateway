function $(sel) {
  return document.querySelector(sel);
}

function formPayload(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return JSON.stringify(data);
}

function setStatus(text, kind) {
  const el = $("#status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

async function waitApi() {
  if (window.pywebview && window.pywebview.api) return window.pywebview.api;
  await new Promise((resolve) => {
    window.addEventListener("pywebviewready", resolve, { once: true });
  });
  return window.pywebview.api;
}

async function loadDefaults() {
  const api = await waitApi();
  const raw = await api.get_defaults();
  const data = JSON.parse(raw);
  const form = $("#setup-form");
  for (const [key, value] of Object.entries(data)) {
    const input = form.elements.namedItem(key);
    if (input && value != null) input.value = value;
  }
}

async function testConnection(form) {
  const api = await waitApi();
  setStatus("正在连接 SimNow…", "wait");
  $("#btn-test").disabled = true;
  $("#btn-save").disabled = true;
  try {
    const raw = await api.test_connection(formPayload(form));
    const result = JSON.parse(raw);
    setStatus(result.msg || (result.ok ? "连接成功" : "连接失败"), result.ok ? "ok" : "err");
  } catch (err) {
    setStatus("测试失败：" + (err && err.message ? err.message : err), "err");
  } finally {
    $("#btn-test").disabled = false;
    $("#btn-save").disabled = false;
  }
}

async function saveConfig(form) {
  const api = await waitApi();
  setStatus("正在保存…", "wait");
  $("#btn-test").disabled = true;
  $("#btn-save").disabled = true;
  try {
    const raw = await api.save_config(formPayload(form));
    const result = JSON.parse(raw);
    if (!result.ok) {
      setStatus(result.msg || "保存失败", "err");
      return;
    }
    setStatus(result.msg || "已保存", "ok");
  } catch (err) {
    setStatus("保存失败：" + (err && err.message ? err.message : err), "err");
  } finally {
    $("#btn-test").disabled = false;
    $("#btn-save").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = $("#setup-form");
  loadDefaults().catch(() => {});
  $("#btn-test").addEventListener("click", () => testConnection(form));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveConfig(form);
  });
});
