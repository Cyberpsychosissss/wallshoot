import { connect, apiGet, apiPost } from "./net.js";
import { renderAuth, fetchMe, logout } from "./auth.js";
import { createRenderer } from "./render.js";
import { attachButtonInput } from "./input.js";
import { audio, unlockAudio } from "./audio.js";
import { showAdmin } from "./admin.js";

const app = document.getElementById("app");

let socket = null;
let me = null;
let sessionCsrf = null;
let renderer = null;
let currentState = null;
let lastEventTick = -1;
let slowmoTimer = null;

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

async function boot() {
  const res = await fetchMe();
  if (res?.user) {
    me = res.user;
    sessionCsrf = res.csrf || null;
    const ac = await apiGet("/api/admin/check");
    me.is_admin = !!ac?.is_admin;
    // Connect socket up-front so the server can auto-resume us into any
    // in-progress room (room:state with resumed=true will land before the
    // menu paints).
    try { await connectSocket(); } catch {}
    // Give the server a brief window to push room:state(resumed) if the
    // user was in an active room when they left.
    await new Promise((r) => setTimeout(r, 400));
    if (!document.body.classList.contains("game-mode") && !document.querySelector(".lobby-code")) {
      showMenu();
    }
  } else {
    showAuth();
  }
}

function showAuth() {
  document.body.classList.remove("game-mode");
  const onSuccess = async (res) => {
    me = res.user;
    sessionCsrf = res.csrf || null;
    const ac = await apiGet("/api/admin/check");
    me.is_admin = !!ac?.is_admin;
    showMenu();
  };
  renderAuth(app, { onSuccess });
}

function showMenu() {
  document.body.classList.remove("game-mode");
  app.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card menu-wrap" });
  card.append(
    el("h1", {}, "Wallshoot"),
    el("p", { className: "sub" }, "隔墙对决 · 双人朋友局"),
    el("div", { className: "menu-user" },
      el("span", {}, me.email),
      el("span", { className: "stats" }, `积分 ${me.rating} · ${me.wins}胜${me.losses}负`),
    ),
    el("div", { className: "menu-actions" },
      Object.assign(el("div", { className: "mode" }, el("h3", {}, "隔墙射击对决"), el("p", {}, "射穿墙体击中对手，BO3 决胜")),
        { onclick: () => showLobby() }),
      Object.assign(el("div", { className: "mode disabled" }, el("h3", {}, "拼枪对决（开发中）"), el("p", {}, "敬请期待")),
        { onclick: () => toast("敬请期待") }),
    ),
    el("div", { className: "row-buttons", style: "margin-top:28px;" },
      Object.assign(el("button", { className: "secondary" }), { textContent: "战绩", onclick: () => showHistory() }),
      Object.assign(el("button", { className: "secondary" }), { textContent: "账号设置", onclick: () => showAccount() }),
      me.is_admin
        ? Object.assign(el("button", { className: "secondary" }), { textContent: "管理后台", onclick: () => showAdmin(app, { onBack: showMenu, sessionCsrf }) })
        : null,
      Object.assign(el("button", { className: "ghost" }), { textContent: "退出登录", onclick: async () => {
        await logout(); me = null; if (socket) { socket.disconnect(); socket = null; }
        showAuth();
      }}),
    ),
  );
  screen.append(card);
  app.append(screen);
}

function showAccount() {
  document.body.classList.remove("game-mode");
  app.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card" });
  card.append(
    el("h1", {}, "账号设置"),
    el("p", { className: "sub" }, me.email),
    el("label", {}, "当前密码"),
    Object.assign(el("input"), { type: "password", id: "old", autocomplete: "current-password" }),
    el("label", {}, "新密码（≥ 8 位）"),
    Object.assign(el("input"), { type: "password", id: "new1", autocomplete: "new-password" }),
    el("label", {}, "再输一遍新密码"),
    Object.assign(el("input"), { type: "password", id: "new2", autocomplete: "new-password" }),
    el("div", { className: "error-msg", id: "err" }),
    el("div", { className: "info-msg", id: "info" }),
    el("div", { className: "pow-progress", id: "powp" }),
    el("div", { className: "row-buttons" },
      Object.assign(el("button", { id: "submit" }), { textContent: "保存" }),
      Object.assign(el("button", { className: "ghost" }), { textContent: "返回菜单", onclick: showMenu }),
    ),
  );
  screen.append(card);
  app.append(screen);

  const errEl = card.querySelector("#err");
  const infoEl = card.querySelector("#info");
  const powp = card.querySelector("#powp");
  const submit = card.querySelector("#submit");
  submit.onclick = async () => {
    errEl.textContent = ""; infoEl.textContent = "";
    const old_password = card.querySelector("#old").value;
    const new1 = card.querySelector("#new1").value;
    const new2 = card.querySelector("#new2").value;
    if (!old_password || !new1 || !new2) { errEl.textContent = "三个框都得填"; return; }
    if (new1 !== new2) { errEl.textContent = "两次新密码不一致"; return; }
    if (new1.length < 8) { errEl.textContent = "新密码至少 8 位"; return; }
    if (new1 === old_password) { errEl.textContent = "新密码不能跟当前密码相同"; return; }
    submit.disabled = true;
    submit.textContent = "验证中…";
    try {
      const ch = await apiPost("/api/pow/challenge", {});
      const pow = await new Promise((resolve, reject) => {
        const w = new Worker(`${window.__BASE__ || ""}/pow.js`);
        w.onmessage = (e) => {
          if (e.data.type === "progress") powp.textContent = `算力验证：${e.data.attempts}`;
          else if (e.data.type === "done") { w.terminate(); resolve({ id: ch.id, nonce: e.data.nonce }); }
          else if (e.data.type === "error") { w.terminate(); reject(new Error(e.data.message)); }
        };
        w.onerror = (err) => { w.terminate(); reject(err); };
        w.postMessage({ challenge: ch.challenge, difficulty: ch.difficulty });
      });
      submit.textContent = "保存中…";
      const res = await apiPost("/api/change-password", { old_password, new_password: new1, pow }, sessionCsrf);
      if (res.error) {
        errEl.textContent = changePwErrMsg(res.error);
      } else {
        infoEl.textContent = "密码已更新（其他设备的登录已被踢下线）";
        card.querySelector("#old").value = "";
        card.querySelector("#new1").value = "";
        card.querySelector("#new2").value = "";
      }
    } catch (e) {
      errEl.textContent = String(e.message || e);
    }
    submit.disabled = false;
    submit.textContent = "保存";
    powp.textContent = "";
  };
}

function changePwErrMsg(code) {
  return ({
    invalid_input: "输入格式不对",
    invalid_password: "新密码至少 8 位",
    same_password: "新密码不能跟当前密码相同",
    invalid_pow: "验证失败，刷新重试",
    bad_old_password: "当前密码错误",
    csrf: "登录已过期，请重新登录",
    unauth: "登录已过期，请重新登录",
  })[code] || code || "出错了";
}

async function showHistory() {
  app.innerHTML = "";
  const res = await apiGet("/api/history");
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "history-list" });
  card.append(el("h2", {}, "最近 20 局"));
  if (!res.matches || res.matches.length === 0) {
    card.append(el("p", { style: "color: var(--text-dim);" }, "暂无对战记录"));
  } else {
    for (const m of res.matches) {
      const isWin = m.winner_id === me.id;
      const oppEmail = isWin ? m.loser_email : m.winner_email;
      const yourRating = isWin ? m.winner_rating_after : m.loser_rating_after;
      const score = isWin ? `${m.winner_score}-${m.loser_score}` : `${m.loser_score}-${m.winner_score}`;
      card.append(
        el("div", { className: "history-row" },
          el("span", { className: "opp" }, oppEmail),
          el("span", { className: "result " + (isWin ? "win" : "loss") }, (isWin ? "胜 " : "负 ") + score),
          el("span", { className: "rating" }, `→ ${yourRating}`),
        ),
      );
    }
  }
  const back = Object.assign(el("button", { className: "secondary", style: "margin-top:16px;" }), { textContent: "返回菜单", onclick: showMenu });
  card.append(back);
  screen.append(card);
  app.append(screen);
}

async function showLobby() {
  app.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card" });
  card.append(
    el("h1", {}, "找个朋友"),
    el("p", { className: "sub" }, "创建房间分享 6 位码，或者输入码加入"),
    el("div", { className: "row-buttons" },
      Object.assign(el("button"), { textContent: "创建房间", onclick: createRoom }),
    ),
    el("label", { style: "margin-top:24px;" }, "或输入对方分享的房间码："),
    el("div", { className: "room-actions" },
      Object.assign(el("input"), { type: "text", id: "code", maxlength: 6, placeholder: "ABCDE2" }),
      Object.assign(el("button"), { textContent: "加入", onclick: joinRoom }),
    ),
    el("div", { className: "error-msg", id: "err" }),
    el("div", { className: "row-buttons", style: "margin-top:28px;" },
      Object.assign(el("button", { className: "ghost" }), { textContent: "← 返回", onclick: showMenu }),
    ),
  );
  screen.append(card);
  app.append(screen);

  if (!socket) await connectSocket();
}

async function connectSocket() {
  socket = await connect();
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (e) => reject(e));
  });
  setupSocketHandlers();
}

function setupSocketHandlers() {
  socket.on("room:state", (s) => {
    if (s.resumed) {
      // Server reattached us to an in-progress room after reconnect
      if (s.status === "playing" && !document.body.classList.contains("game-mode")) {
        showGame(s);
      }
      hideReconnectOverlay("self");
      return;
    }
    if (s.status === "waiting") showWaitingRoom(s.code);
    else if (s.status === "playing") showGame(s);
  });
  socket.on("room:expired", () => {
    toast("房间已过期");
    showMenu();
  });
  socket.on("game:state", (state) => {
    currentState = state;
    if (renderer) renderer.draw(state);
    updateHud(state);
    if (state.events && state.tick !== lastEventTick) {
      for (const ev of state.events) handleEvent(ev, state);
      lastEventTick = state.tick;
    }
  });
  socket.on("game:slowmo", (payload) => {
    audio.whoosh();
    showSlowmoOverlay(payload);
  });
  socket.on("game:match_end", (result) => {
    if (slowmoTimer) { clearTimeout(slowmoTimer); slowmoTimer = null; }
    showMatchEnd(result);
  });
  socket.on("game:opponent_disconnected", ({ grace_ms }) => {
    showOpponentDisconnectedOverlay(grace_ms || 30000);
  });
  socket.on("game:opponent_rejoined", () => {
    hideReconnectOverlay("opponent");
    toast("对手回来了");
  });
  socket.on("game:opponent_left", () => {
    hideReconnectOverlay("opponent");
    toast("对手离开了房间");
    setTimeout(showMenu, 1500);
  });
  socket.on("disconnect", () => {
    if (document.body.classList.contains("game-mode") || document.querySelector(".lobby-code")) {
      showSelfReconnectingOverlay();
    }
  });
  socket.on("reconnect_failed", () => {
    hideReconnectOverlay("self");
    if (document.body.classList.contains("game-mode") || document.querySelector(".lobby-code")) {
      toast("重连失败，返回菜单");
      setTimeout(showMenu, 1500);
    }
  });
}

// ── Reconnect overlays ────────────────────────────────────────────────
let selfReconnectOverlay = null;
let opponentDisconnectOverlay = null;
let opponentCountdownTimer = null;

function showSelfReconnectingOverlay() {
  if (selfReconnectOverlay) return;
  selfReconnectOverlay = el("div", { className: "overlay reconnect" });
  selfReconnectOverlay.innerHTML = `
    <div class="spinner"></div>
    <h2>连接中断</h2>
    <p>正在重连，请稍候…</p>
    <p style="font-size:12px;margin-top:6px;">如果一直没反应，刷新页面重新登录</p>
  `;
  document.body.append(selfReconnectOverlay);
}

function showOpponentDisconnectedOverlay(graceMs) {
  hideReconnectOverlay("opponent");
  const startedAt = Date.now();
  opponentDisconnectOverlay = el("div", { className: "overlay reconnect opponent" });
  opponentDisconnectOverlay.innerHTML = `
    <h2 style="color:var(--warn);">对手掉线</h2>
    <p>等待对方重连，<span class="cd">${Math.ceil(graceMs / 1000)}</span>s 内未回来将判离场</p>
  `;
  document.body.append(opponentDisconnectOverlay);
  opponentCountdownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((graceMs - (Date.now() - startedAt)) / 1000));
    const cd = opponentDisconnectOverlay?.querySelector(".cd");
    if (cd) cd.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(opponentCountdownTimer);
      opponentCountdownTimer = null;
    }
  }, 500);
}

function hideReconnectOverlay(which) {
  if ((which === "self" || which === "both") && selfReconnectOverlay) {
    selfReconnectOverlay.remove();
    selfReconnectOverlay = null;
  }
  if ((which === "opponent" || which === "both") && opponentDisconnectOverlay) {
    opponentDisconnectOverlay.remove();
    opponentDisconnectOverlay = null;
    if (opponentCountdownTimer) { clearInterval(opponentCountdownTimer); opponentCountdownTimer = null; }
  }
}

async function createRoom() {
  unlockAudio();
  if (!socket) await connectSocket();
  socket.emit("room:create", {}, (res) => {
    if (!res?.ok) toast("创建失败：" + (res?.error || "未知"));
  });
}

async function joinRoom() {
  unlockAudio();
  const codeIn = document.getElementById("code");
  if (!codeIn) return;
  const code = codeIn.value.trim().toUpperCase();
  if (code.length !== 6) { showErr("房间码 6 位"); return; }
  if (!socket) await connectSocket();
  socket.emit("room:join", { code }, (res) => {
    if (!res?.ok) showErr(joinErrMsg(res?.error));
  });
}

function showErr(msg) {
  const e = document.getElementById("err");
  if (e) e.textContent = msg;
}

function joinErrMsg(code) {
  return {
    not_found: "房间不存在",
    full: "房间已满",
    bad_code: "房间码格式错误",
    same_user: "不能加入自己的房间",
  }[code] || code || "加入失败";
}

function showWaitingRoom(code) {
  app.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card" });
  card.append(
    el("h1", {}, "房间已开"),
    el("p", { className: "sub" }, "分享下方房间码给朋友，等他加入即可开打"),
    el("div", { className: "lobby-code" }, code),
    el("div", { className: "lobby-wait" }, "等待对方加入..."),
    el("div", { className: "row-buttons", style: "margin-top:28px;" },
      Object.assign(el("button", { className: "secondary" }), {
        textContent: "复制房间码",
        onclick: () => {
          navigator.clipboard?.writeText(code).then(() => toast("已复制"));
        },
      }),
      Object.assign(el("button", { className: "ghost" }), {
        textContent: "取消",
        onclick: () => {
          if (socket) socket.emit("room:leave");
          showMenu();
        },
      }),
    ),
  );
  screen.append(card);
  app.append(screen);
}

function showGame(roomState) {
  document.body.classList.add("game-mode");
  app.innerHTML = "";
  const root = el("div", { className: "game-root" });
  const canvas = el("canvas", { className: "game-canvas" });
  root.append(canvas);

  // Top row: room code | score | timer
  const hudTop = el("div", { className: "hud-top" });
  hudTop.innerHTML = `
    <div class="hud-pill code" id="hud-code">${roomState.code}</div>
    <div class="hud-pill score" id="hud-score">0 - 0</div>
    <div class="hud-pill" id="hud-timer"></div>
  `;
  root.append(hudTop);

  // HP bar + ammo strip — sit just under the top pills, full width
  const hudStatus = el("div", { className: "hud-status" });
  hudStatus.innerHTML = `
    <div class="hp-block">
      <span class="hp-tag">HP</span>
      <div class="hp-bar"><div class="hp-fill" id="hp-self" style="width:100%"></div></div>
      <span class="hp-num" id="hp-label">100</span>
    </div>
    <div class="ammo-block" id="ammo-block">
      <span class="ammo-tag">弹</span>
      <div class="ammo-strip" id="ammo-strip"></div>
    </div>
  `;
  root.append(hudStatus);

  // Status banner — short message above the wall ("对方正在射击" / "你要躲好" etc.)
  const banner = el("div", { className: "status-banner", id: "status-banner" });
  banner.innerHTML = `<span class="banner-text" id="banner-text"></span>`;
  root.append(banner);

  // ── Control panel: shooter buttons (right) + hider buttons (left) ──
  const controls = el("div", { className: "controls" });
  controls.innerHTML = `
    <div class="ctrl-group ctrl-hider" id="ctrl-hider">
      <button class="ctrl-btn move-btn big arrow-btn" id="btn-move-left">◀</button>
      <div class="action-row">
        <button class="action-btn" id="btn-stand" title="站立"><span class="al">站</span></button>
        <button class="action-btn" id="btn-crouch" title="蹲下"><span class="al">蹲</span></button>
        <button class="action-btn" id="btn-prone" title="趴下"><span class="al">趴</span></button>
        <button class="action-btn" id="btn-dodge" title="闪避"><span class="al">闪</span></button>
        <button class="action-btn" id="btn-jump" title="跳起"><span class="al">跳</span></button>
      </div>
      <button class="ctrl-btn move-btn big arrow-btn" id="btn-move-right">▶</button>
    </div>
    <div class="ctrl-group ctrl-shooter" id="ctrl-shooter">
      <div class="dpad">
        <button class="ctrl-btn dpad-up" id="btn-aim-up">▲</button>
        <button class="ctrl-btn dpad-left" id="btn-aim-left">◀</button>
        <button class="ctrl-btn dpad-right" id="btn-aim-right">▶</button>
        <button class="ctrl-btn dpad-down" id="btn-aim-down">▼</button>
      </div>
      <button class="ctrl-btn fire-btn" id="btn-fire">射击</button>
    </div>
  `;
  root.append(controls);

  app.append(root);

  renderer = createRenderer(canvas);
  attachButtonInput({
    sendInput: (input) => socket.emit("game:input", input),
    getState: () => currentState,
  });
}

function updateHud(state) {
  const score = document.getElementById("hud-score");
  if (score) score.textContent = `${state.scoreA} - ${state.scoreB}`;
  const timer = document.getElementById("hud-timer");
  if (timer) {
    if (state.timer != null) {
      timer.textContent = `${Math.ceil(state.timer)}s`;
      timer.classList.add("timer");
    } else {
      timer.textContent = state.phase === "battle" ? "战斗中" : "";
    }
  }
  const meP = state.players[state.viewerIdx];
  const fill = document.getElementById("hp-self");
  const label = document.getElementById("hp-label");
  if (fill) {
    fill.style.width = `${meP.hp}%`;
    fill.className = "hp-fill" + (meP.hp < 30 ? " danger" : meP.hp < 60 ? " warn" : "");
  }
  if (label) label.textContent = String(meP.hp);
  const ammoEl = document.getElementById("ammo-strip");
  const ammoBlock = document.getElementById("ammo-block");
  const isShooter = state.shooterIdx === state.viewerIdx;
  if (ammoEl) {
    const ammo = isShooter ? meP.ammo : 0;
    const total = 6;
    let html = "";
    for (let i = 0; i < total; i++) html += `<div class="ammo-dot${i < ammo ? "" : " spent"}"></div>`;
    ammoEl.innerHTML = html;
  }
  if (ammoBlock) {
    ammoBlock.classList.toggle("dim", !isShooter);
  }
  // Show only the control set matching the current role
  const root = document.querySelector(".game-root");
  if (root) {
    root.classList.toggle("role-shooter", !!isShooter);
    root.classList.toggle("role-hider", !isShooter);
  }
  const fireBtn = document.getElementById("btn-fire");
  if (fireBtn) {
    const live = isShooter && state.phase === "battle" && state.players[state.viewerIdx].ammo > 0;
    fireBtn.disabled = !live;
  }

  // Status banner content per role / phase
  const bannerText = document.getElementById("banner-text");
  if (bannerText) {
    let msg = "";
    if (state.phase === "prep") {
      msg = isShooter ? "对方正在准备…" : "选好位置 · 等待开战";
    } else if (state.phase === "battle") {
      if (isShooter) msg = "瞄准 · 等他露头";
      else msg = "敌人正在射击 · 你要躲好";
    } else if (state.phase === "slowmo") {
      msg = "致命一击";
    } else if (state.phase === "round_end") {
      msg = "本局结束";
    } else if (state.phase === "match_end") {
      msg = "对战结束";
    }
    bannerText.textContent = msg;
  }

  // Highlight the active posture button
  const posMap = { stand: "btn-stand", crouch: "btn-crouch", prone: "btn-prone" };
  for (const [pos, id] of Object.entries(posMap)) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle("active", meP.posture === pos && !meP.action);
  }
  const dodgeBtn = document.getElementById("btn-dodge");
  if (dodgeBtn) dodgeBtn.classList.toggle("active", meP.action === "dodge_left" || meP.action === "dodge_right");
  const jumpBtn = document.getElementById("btn-jump");
  if (jumpBtn) jumpBtn.classList.toggle("active", meP.action === "jump");
}

function handleEvent(ev, state) {
  switch (ev.t) {
    case "wall_break": audio.wallBreak(); break;
    case "hit": audio.hit(ev.part); break;
    case "swap": audio.click(); break;
    case "round_start": audio.click(); break;
  }
}

function showSlowmoOverlay(payload) {
  const root = document.querySelector(".game-root");
  if (!root) return;
  const old = root.querySelector(".overlay.slowmo");
  if (old) old.remove();
  const ov = el("div", { className: "overlay slowmo" });
  ov.innerHTML = `<h2>致命一击</h2><p>击中：${zhPart(payload.partHit)}</p>`;
  root.append(ov);
  slowmoTimer = setTimeout(() => ov.remove(), 1500);
}

function zhPart(p) {
  return { head: "头部", torso: "躯干", limb: "四肢" }[p] || p;
}

function showMatchEnd(result) {
  const root = document.querySelector(".game-root");
  if (!root) return;
  const win = result.viewerIdx === result.winnerIdx;
  const ov = el("div", { className: "overlay" });
  ov.innerHTML = `
    <h2 style="color:${win ? "var(--good)" : "var(--bad)"};">${win ? "胜利！" : "败北"}</h2>
    <p>比分 ${result.scoreA} - ${result.scoreB}</p>
    ${result.settlement ? `<p>积分 ${win ? "+" : "-"}${Math.abs(result.settlement.delta)}</p>` : ""}
  `;
  const btns = el("div", { className: "row-buttons", style: "margin-top:18px;" },
    Object.assign(el("button"), { textContent: "再来一局", onclick: () => { ov.remove(); if (socket) socket.emit("room:leave"); showLobby(); } }),
    Object.assign(el("button", { className: "secondary" }), { textContent: "返回菜单", onclick: async () => {
      ov.remove();
      if (socket) { socket.emit("room:leave"); }
      const fresh = await fetchMe();
      if (fresh?.user) me = fresh.user;
      showMenu();
    }}),
  );
  ov.append(btns);
  root.append(ov);
}

function toast(msg) {
  const t = el("div");
  Object.assign(t.style, {
    position: "fixed", left: "50%", top: "20px",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "#fff", padding: "10px 20px",
    borderRadius: "8px", zIndex: 9999,
    fontSize: "14px", border: "1px solid #333",
  });
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

boot();
