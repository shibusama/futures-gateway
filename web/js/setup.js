function $(sel) {
  return document.querySelector(sel);
}

let catalog = null;

function isSettingsMode() {
  return new URLSearchParams(location.search).get("mode") === "settings";
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

function applyProfileToForm(form, profileId) {
  if (!catalog) return;
  const prof = catalog.simnow_fronts.find((p) => p.id === profileId);
  if (!prof) return;
  form.elements.namedItem("front_profile_id").value = prof.id;
  form.elements.namedItem("trade_front").value = prof.trade_front;
  form.elements.namedItem("md_front").value = prof.md_front;
  document.querySelectorAll(".front-card").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === profileId);
  });
}

function renderFrontCards(form) {
  const list = $("#front-list");
  if (!catalog || !list) return;
  list.innerHTML = catalog.simnow_fronts.map((p) => `
    <button type="button" class="front-card${p.recommended ? " recommended" : ""}" data-id="${p.id}" role="radio" aria-checked="false">
      <span class="front-card-head">
        <strong>${p.label}</strong>
        ${p.recommended ? '<span class="tag">推荐</span>' : ""}
      </span>
      <span class="front-hours">${p.hours}</span>
      <span class="front-addr">交易 ${p.trade_front.replace("tcp://", "")}</span>
      <span class="front-addr">行情 ${p.md_front.replace("tcp://", "")}</span>
    </button>`).join("");

  list.querySelectorAll(".front-card").forEach((btn) => {
    btn.addEventListener("click", () => applyProfileToForm(form, btn.dataset.id));
  });
}

function renderAccountTypes(form) {
  const sel = $("#account-type");
  if (!catalog || !sel) return;
  sel.innerHTML = catalog.account_types.map((t) =>
    `<option value="${t.id}" ${t.enabled ? "" : "disabled"}>${t.label}${t.enabled ? "" : "（即将支持）"}</option>`).join("");
  sel.addEventListener("change", () => syncAccountTypeUI(form));
}

function syncAccountTypeUI(form) {
  const type = form.elements.namedItem("account_type").value;
  const meta = catalog?.account_types?.find((t) => t.id === type);
  $("#account-type-hint").textContent = meta?.hint || "";
  const simnow = type === "simnow";
  $("#simnow-fronts-wrap").hidden = !simnow;
  $("#live-fronts-wrap").hidden = simnow;
  form.elements.namedItem("broker_id").readOnly = simnow;
  if (simnow && meta?.broker_id) {
    form.elements.namedItem("broker_id").value = meta.broker_id;
  }
}

function initPageChrome() {
  if (isSettingsMode()) {
    $("#btn-back").hidden = false;
    $("#page-title").textContent = "账号配置";
    $("#page-subtitle").textContent = "修改 SimNow 账号或切换前置站点，保存后返回交易界面。";
    document.title = "期界 · 账号配置";
  }
}

async function loadCatalog(api) {
  if (api.get_front_profiles) {
    catalog = JSON.parse(await api.get_front_profiles());
  } else {
    catalog = {
      account_types: [{ id: "simnow", label: "SimNow 仿真", enabled: true, broker_id: "9999", hint: "" }],
      simnow_fronts: [],
      default_simnow_profile_id: "simnow-7x24",
    };
  }
}

async function loadDefaults(form) {
  const api = await waitApi();
  await loadCatalog(api);
  renderAccountTypes(form);
  renderFrontCards(form);
  initPageChrome();

  const raw = await api.get_defaults();
  const data = JSON.parse(raw);
  for (const [key, value] of Object.entries(data)) {
    const input = form.elements.namedItem(key);
    if (input && value != null) input.value = value;
  }
  syncAccountTypeUI(form);
  const pid = data.front_profile_id || catalog.default_simnow_profile_id;
  applyProfileToForm(form, pid);

  $("#btn-back")?.addEventListener("click", async () => {
    if (api.go_back) {
      await api.go_back();
    }
  });
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
  loadDefaults(form).catch(() => {});
  $("#btn-test").addEventListener("click", () => testConnection(form));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveConfig(form);
  });
  form.elements.namedItem("trade_front")?.addEventListener("change", () => {
    form.elements.namedItem("front_profile_id").value = "";
  });
  form.elements.namedItem("md_front")?.addEventListener("change", () => {
    form.elements.namedItem("front_profile_id").value = "";
  });
});
