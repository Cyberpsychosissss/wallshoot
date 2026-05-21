import { connect, apiGet, apiPost } from "./net.js";
import { renderLogin, renderRegister, fetchMe, logout } from "./auth.js";
import { createRenderer } from "./render.js";
import { attachInput } from "./input.js";
import { audio, unlockAudio } from "./audio.js";

const app = document.getElementById("app");

let socket = null;
let me = null;
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
    showMenu();
  } else {
    showAuth("login");
  }
}

function showAuth(which) {
  document.body.classList.remove("game-mode");
  const switchTo = (next) => showAuth(next);
  const onSuccess = (res) => {
    me = res.user;
    showMenu();
  };
  if (which === "register") renderRegister(app, { switchTo, onSuccess });
  else renderLogin(app, { switchTo, onSuccess });
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
      Object.assign(el("button", { className: "ghost" }), { textContent: "退出登录", onclick: async () => {
        await logout(); me = null; if (socket) { socket.disconnect(); socket = null; }
        showAuth("login");
      }}),
    ),
  );
  screen.append(card);
  app.append(screen);
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
  socket.on("game:opponent_left", () => {
    toast("对手离开了房间");
    setTimeout(showMenu, 1500);
  });
  socket.on("disconnect", () => {
    if (document.body.classList.contains("game-mode")) toast("连接断开");
  });
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

  // HUD
  const hudTop = el("div", { className: "hud-top" });
  hudTop.innerHTML = `
    <div class="hud-pill code" id="hud-code">${roomState.code}</div>
    <div class="hud-pill score" id="hud-score">0 - 0</div>
    <div class="hud-pill" id="hud-timer"></div>
  `;
  root.append(hudTop);

  const hudBottom = el("div", { className: "hud-bottom" });
  hudBottom.innerHTML = `
    <div class="hp-bar"><div class="hp-fill" id="hp-self" style="width:100%"></div><div class="hp-label" id="hp-label">HP 100</div></div>
    <div class="ammo-strip" id="ammo-strip"></div>
  `;
  root.append(hudBottom);

  const fireBtn = el("div", { className: "touch-fire-btn" }, "开火");
  root.append(fireBtn);

  app.append(root);

  renderer = createRenderer(canvas);
  attachInput(canvas, renderer, {
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
  const me = state.players[state.viewerIdx];
  const fill = document.getElementById("hp-self");
  const label = document.getElementById("hp-label");
  if (fill) {
    fill.style.width = `${me.hp}%`;
    fill.className = "hp-fill" + (me.hp < 30 ? " danger" : me.hp < 60 ? " warn" : "");
  }
  if (label) label.textContent = `HP ${me.hp}`;
  const ammoEl = document.getElementById("ammo-strip");
  const isShooter = state.shooterIdx === state.viewerIdx;
  if (ammoEl) {
    const ammo = isShooter ? state.players[state.viewerIdx].ammo : 0;
    const total = 6;
    let html = "";
    for (let i = 0; i < total; i++) html += `<div class="ammo-dot${i < ammo ? "" : " spent"}"></div>`;
    ammoEl.innerHTML = html;
    ammoEl.style.opacity = isShooter ? "1" : "0.3";
  }
  // Role pill on the timer slot when no countdown
  const fireBtn = document.querySelector(".touch-fire-btn");
  if (fireBtn) {
    fireBtn.style.opacity = (isShooter && state.phase === "battle") ? "1" : "0.3";
    fireBtn.style.pointerEvents = (isShooter && state.phase === "battle") ? "auto" : "none";
  }
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
