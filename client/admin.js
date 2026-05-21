import { apiGet, apiPost } from "./net.js";

const BASE = window.__BASE__ || "";

let csrf = null;
let activeTab = "stats";

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

async function adminFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.method && opts.method !== "GET" && csrf) {
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    credentials: "same-origin",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return {};
  return res.json().catch(() => ({ error: "bad_response" }));
}

export async function showAdmin(mount, { onBack, sessionCsrf }) {
  csrf = sessionCsrf;
  document.body.classList.remove("game-mode");
  mount.innerHTML = "";
  const root = el("div", { className: "admin-root" });

  const header = el("div", { className: "admin-header" },
    el("h2", {}, "Wallshoot 管理后台"),
    el("div", { className: "admin-header-right" },
      Object.assign(el("button", { className: "ghost" }), { textContent: "← 返回菜单", onclick: onBack }),
    ),
  );

  const tabs = el("div", { className: "admin-tabs" });
  for (const [key, label] of [["stats", "数据统计"], ["users", "用户管理"], ["params", "玩法参数"]]) {
    const t = el("button", { className: "admin-tab" + (activeTab === key ? " active" : "") }, label);
    t.onclick = () => {
      activeTab = key;
      showAdmin(mount, { onBack, sessionCsrf });
    };
    tabs.append(t);
  }

  const body = el("div", { className: "admin-body", id: "admin-body" });

  root.append(header, tabs, body);
  mount.append(root);

  if (activeTab === "stats") await renderStats(body);
  else if (activeTab === "users") await renderUsers(body);
  else if (activeTab === "params") await renderParams(body);
}

// ── Stats Tab ──────────────────────────────────────────────────────────
async function renderStats(body) {
  body.innerHTML = '<div class="admin-loading">载入中...</div>';
  const data = await adminFetch("/api/admin/stats");
  if (data.error) {
    body.innerHTML = `<div class="error-msg">${data.error}</div>`;
    return;
  }
  body.innerHTML = "";

  const cards = el("div", { className: "admin-stat-grid" },
    statCard("总用户", data.users_total),
    statCard("已激活", data.users_activated, "of " + data.users_total),
    statCard("近 7 天注册", data.users_new_7d),
    statCard("活跃 session", data.sessions_active),
    statCard("总对局", data.matches_total),
    statCard("近 24h 对局", data.matches_24h),
    statCard("近 7 天对局", data.matches_7d),
  );
  body.append(cards);

  body.append(
    el("h3", { className: "admin-section-title" }, "积分榜 Top 10"),
    leaderboardTable(data.top_ratings, "rating"),
  );
  body.append(
    el("h3", { className: "admin-section-title" }, "活跃榜（按对局总数）"),
    leaderboardTable(data.most_active, "active"),
  );
}

function statCard(label, value, sub) {
  return el("div", { className: "admin-stat-card" },
    el("div", { className: "label" }, label),
    el("div", { className: "value" }, String(value)),
    sub ? el("div", { className: "sub" }, sub) : null,
  );
}

function leaderboardTable(rows, kind) {
  if (!rows || rows.length === 0) {
    return el("div", { className: "admin-empty" }, "暂无数据");
  }
  const table = el("table", { className: "admin-table" });
  const head = el("thead", {}, el("tr", {},
    el("th", {}, "#"),
    el("th", {}, "邮箱"),
    el("th", {}, "积分"),
    el("th", {}, kind === "active" ? "对局" : "胜/负"),
  ));
  const body = el("tbody", {});
  rows.forEach((r, i) => {
    body.append(el("tr", {},
      el("td", { className: "rank" }, String(i + 1)),
      el("td", {}, r.email),
      el("td", { className: "mono" }, String(r.rating)),
      el("td", { className: "mono" }, kind === "active"
        ? String(r.total_games)
        : `${r.wins ?? 0} / ${r.losses ?? 0}`),
    ));
  });
  table.append(head, body);
  return table;
}

// ── Users Tab ──────────────────────────────────────────────────────────
let usersState = { q: "", offset: 0, limit: 25 };

async function renderUsers(body) {
  body.innerHTML = "";

  const controls = el("div", { className: "admin-controls" });
  const search = Object.assign(el("input"), {
    type: "text", placeholder: "搜索邮箱…", value: usersState.q,
  });
  let timer;
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      usersState.q = search.value.trim();
      usersState.offset = 0;
      refreshUsers(body);
    }, 250);
  };
  controls.append(search);
  body.append(controls);

  const list = el("div", { id: "users-list", className: "admin-loading" }, "载入中...");
  body.append(list);
  await refreshUsers(body);
}

async function refreshUsers(body) {
  const list = body.querySelector("#users-list");
  if (!list) return;
  list.innerHTML = "载入中...";
  const params = new URLSearchParams({
    q: usersState.q,
    offset: usersState.offset,
    limit: usersState.limit,
  });
  const data = await adminFetch(`/api/admin/users?${params}`);
  if (data.error) {
    list.innerHTML = `<div class="error-msg">${data.error}</div>`;
    return;
  }
  list.innerHTML = "";
  list.className = "";

  const table = el("table", { className: "admin-table users-table" });
  table.append(el("thead", {}, el("tr", {},
    el("th", {}, "ID"),
    el("th", {}, "邮箱"),
    el("th", {}, "激活"),
    el("th", {}, "积分"),
    el("th", {}, "胜/负"),
    el("th", {}, "状态"),
    el("th", {}, "注册时间"),
    el("th", {}, "操作"),
  )));
  const tbody = el("tbody", {});
  for (const u of data.users) {
    const lockedNow = u.locked_until > Date.now();
    const tr = el("tr", { className: lockedNow ? "row-locked" : "" });
    tr.append(
      el("td", { className: "mono" }, String(u.id)),
      el("td", {}, u.email),
      el("td", {}, u.activated ? "✓" : "✗"),
      el("td", { className: "mono" }, String(u.rating)),
      el("td", { className: "mono" }, `${u.wins}/${u.losses}`),
      el("td", {}, lockedNow ? `锁至 ${fmtDate(u.locked_until)}` : (u.failed_login_count > 0 ? `失败 ${u.failed_login_count}` : "正常")),
      el("td", { className: "mono small" }, fmtDate(u.created_at)),
      el("td", { className: "row-actions" },
        Object.assign(el("button", { className: "ghost small" }), {
          textContent: "重置密码",
          onclick: () => resetPasswordFor(u),
        }),
        Object.assign(el("button", { className: "ghost small" }), {
          textContent: lockedNow ? "解封" : "封号",
          onclick: () => lockToggleFor(u, lockedNow ? "unlock" : "lock", body),
        }),
        Object.assign(el("button", { className: "ghost small danger" }), {
          textContent: "删除",
          onclick: () => deleteUserFor(u, body),
        }),
      ),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  list.append(table);

  // Pagination
  const pager = el("div", { className: "admin-pager" },
    el("span", {}, `${usersState.offset + 1} – ${Math.min(usersState.offset + usersState.limit, data.total)} / ${data.total}`),
    Object.assign(el("button", { className: "ghost", disabled: usersState.offset === 0 }), {
      textContent: "上一页",
      onclick: () => { usersState.offset = Math.max(0, usersState.offset - usersState.limit); refreshUsers(body); },
    }),
    Object.assign(el("button", { className: "ghost", disabled: usersState.offset + usersState.limit >= data.total }), {
      textContent: "下一页",
      onclick: () => { usersState.offset = usersState.offset + usersState.limit; refreshUsers(body); },
    }),
  );
  list.append(pager);
}

async function resetPasswordFor(user) {
  if (!confirm(`确定重置 ${user.email} 的密码？\n该用户当前所有 session 会被踢下线。`)) return;
  const res = await adminFetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
  if (res.error) {
    alert("失败：" + res.error);
    return;
  }
  prompt("临时密码（请尽快告知用户并让其登录后修改）：", res.temporary_password);
}

async function lockToggleFor(user, action, body) {
  if (action === "lock" && !confirm(`封禁 ${user.email}？\n他将无法登录直到你解封。`)) return;
  const res = await adminFetch(`/api/admin/users/${user.id}/lock`, {
    method: "POST",
    body: { action },
  });
  if (res.error) {
    alert("失败：" + res.error);
    return;
  }
  refreshUsers(body);
}

async function deleteUserFor(user, body) {
  const confirmEmail = prompt(`要删除 ${user.email}？\n该操作不可撤销，账号 + 所有 session 都会被清。\n输入完整邮箱以确认：`);
  if (confirmEmail !== user.email) {
    if (confirmEmail != null) alert("邮箱不匹配，已取消");
    return;
  }
  const res = await adminFetch(`/api/admin/users/${user.id}`, {
    method: "DELETE",
    body: { confirm_email: confirmEmail },
  });
  if (res.error) {
    alert("失败：" + res.error);
    return;
  }
  refreshUsers(body);
}

// ── Params Tab ─────────────────────────────────────────────────────────
async function renderParams(body) {
  body.innerHTML = '<div class="admin-loading">载入中...</div>';
  const data = await adminFetch("/api/admin/settings");
  if (data.error) {
    body.innerHTML = `<div class="error-msg">${data.error}</div>`;
    return;
  }
  body.innerHTML = "";

  const intro = el("div", { className: "admin-intro" },
    el("p", {}, "调整后即刻生效，仅影响"),
    el("strong", {}, "未开始的对局"),
    el("p", {}, "。当前正在进行的房间不受影响。"),
  );
  body.append(intro);

  const form = el("div", { className: "admin-params" });
  for (const [key, spec] of Object.entries(data.settings)) {
    form.append(paramRow(key, spec, body));
  }
  body.append(form);

  body.append(
    el("div", { className: "admin-controls", style: "margin-top: 24px;" },
      Object.assign(el("button", { className: "secondary" }), {
        textContent: "全部重置为默认",
        onclick: async () => {
          if (!confirm("把所有玩法参数重置为代码默认值？")) return;
          const res = await adminFetch("/api/admin/settings/reset", { method: "POST" });
          if (res.error) alert("失败：" + res.error);
          else renderParams(body);
        },
      }),
    ),
  );
}

function paramRow(key, spec, body) {
  const row = el("div", { className: "admin-param-row" });
  const label = el("label", {},
    el("div", { className: "name" }, spec.label),
    el("div", { className: "key" }, key),
  );
  const meta = el("div", { className: "meta" },
    el("span", {}, `默认 ${spec.default}`),
    el("span", {}, `范围 ${spec.min}–${spec.max}`),
  );
  const input = Object.assign(el("input"), {
    type: "number",
    value: String(spec.value),
    min: spec.min,
    max: spec.max,
  });
  input.dataset.original = String(spec.value);
  const save = Object.assign(el("button", { className: "small", disabled: true }), {
    textContent: "应用",
  });
  input.oninput = () => {
    save.disabled = input.value === input.dataset.original;
  };
  save.onclick = async () => {
    const val = parseInt(input.value);
    if (!Number.isFinite(val)) return;
    save.disabled = true;
    save.textContent = "保存中…";
    const res = await adminFetch("/api/admin/settings", {
      method: "PUT",
      body: { key, value: val },
    });
    save.textContent = "应用";
    if (res.error) {
      alert("失败：" + res.error);
      save.disabled = false;
      return;
    }
    input.dataset.original = String(res.value);
    input.value = String(res.value);
    save.disabled = true;
    flash(row);
  };
  const valueDeviates = spec.value !== spec.default;
  if (valueDeviates) row.classList.add("modified");
  row.append(label, meta, input, save);
  return row;
}

function flash(node) {
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 600);
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
