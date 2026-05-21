import { apiPost, apiGet } from "./net.js";

const BASE = window.__BASE__ || "";

async function fetchPow() {
  return apiPost("/api/pow/challenge", {});
}

function powWorker(challenge, difficulty, onProgress) {
  const w = new Worker(`${BASE}/pow.js`);
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      if (e.data.type === "progress") onProgress?.(e.data.attempts);
      else if (e.data.type === "done") {
        w.terminate();
        resolve({ nonce: e.data.nonce, ms: e.data.ms });
      } else if (e.data.type === "error") {
        w.terminate();
        reject(new Error(e.data.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(e);
    };
    w.postMessage({ challenge, difficulty });
  });
}

async function runPow(onProgress) {
  const ch = await fetchPow();
  if (!ch || ch.error) throw new Error(ch?.error || "pow_failed");
  const sol = await powWorker(ch.challenge, ch.difficulty, onProgress);
  return { id: ch.id, nonce: sol.nonce };
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "className") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else e[k] = v;
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

// Shared state across renders so the email survives Tab switches.
const state = { mode: "login", email: "", codeCooldownUntil: 0 };

export function renderAuth(mount, { onSuccess }) {
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card auth-card" });
  card.append(
    el("h1", {}, "Wallshoot"),
    el("p", { className: "sub" }, "隔墙对决 · 双人朋友局"),
  );

  // Tab strip
  const tabs = el("div", { className: "auth-tabs" });
  for (const [m, label] of [["login", "登录"], ["register", "注册"]]) {
    const t = el("button", {
      className: "auth-tab" + (state.mode === m ? " active" : ""),
      onClick: () => {
        // Capture email from whichever input is currently visible before re-render
        const emailIn = card.querySelector('input[type="email"]');
        if (emailIn) state.email = emailIn.value.trim();
        state.mode = m;
        mount.innerHTML = "";
        renderAuth(mount, { onSuccess });
      },
    }, label);
    tabs.append(t);
  }
  card.append(tabs);

  const body = el("div", { className: "auth-body" });
  card.append(body);
  if (state.mode === "login") renderLoginForm(body, onSuccess);
  else renderRegisterForm(body, onSuccess);

  screen.append(card);
  mount.innerHTML = "";
  mount.append(screen);
}

function renderLoginForm(body, onSuccess) {
  const emailIn = el("input", { type: "email", id: "email", autocomplete: "email", placeholder: "you@example.com", value: state.email });
  const pwIn = el("input", { type: "password", id: "password", autocomplete: "current-password", placeholder: "至少 8 位" });
  const err = el("div", { className: "error-msg", id: "err" });
  const powp = el("div", { className: "pow-progress", id: "powp" });
  const submit = el("button", { id: "submit" }, "登录");

  submit.addEventListener("click", async () => {
    err.textContent = "";
    state.email = emailIn.value.trim();
    if (!state.email || !pwIn.value) { err.textContent = "邮箱和密码都得填"; return; }
    submit.disabled = true;
    submit.textContent = "验证中…";
    try {
      const pow = await runPow((n) => (powp.textContent = `算力验证：${n}`));
      submit.textContent = "登录中…";
      const res = await apiPost("/api/login", { email: state.email, password: pwIn.value, pow });
      if (res.error) {
        err.textContent = errMsg(res.error, res);
      } else {
        powp.textContent = "";
        onSuccess(res);
      }
    } catch (e) {
      err.textContent = String(e.message || e);
    }
    submit.disabled = false;
    submit.textContent = "登录";
    powp.textContent = "";
  });

  body.append(
    el("label", {}, "邮箱"), emailIn,
    el("label", {}, "密码"), pwIn,
    err, powp, submit,
  );
}

function renderRegisterForm(body, onSuccess) {
  const emailIn = el("input", { type: "email", id: "email", autocomplete: "email", placeholder: "you@example.com", value: state.email });

  const codeRow = el("div", { className: "code-row" });
  const codeIn = el("input", {
    type: "text", id: "code", inputMode: "numeric", maxLength: 6,
    autocomplete: "one-time-code", placeholder: "6 位验证码",
  });
  const codeBtn = el("button", { className: "secondary code-btn", id: "code-btn" }, "获取验证码");
  codeRow.append(codeIn, codeBtn);

  const pw1 = el("input", { type: "password", id: "pw1", autocomplete: "new-password", placeholder: "至少 8 位" });
  const pw2 = el("input", { type: "password", id: "pw2", autocomplete: "new-password", placeholder: "再输一遍" });
  const err = el("div", { className: "error-msg", id: "err" });
  const info = el("div", { className: "info-msg", id: "info" });
  const powp = el("div", { className: "pow-progress", id: "powp" });
  const submit = el("button", { id: "submit" }, "注册并登录");

  // ── Get code button with 60s cooldown ──
  const refreshCodeBtn = () => {
    const remaining = Math.max(0, Math.ceil((state.codeCooldownUntil - Date.now()) / 1000));
    if (remaining > 0) {
      codeBtn.disabled = true;
      codeBtn.textContent = `${remaining}s 后可重发`;
    } else {
      codeBtn.disabled = false;
      codeBtn.textContent = "获取验证码";
    }
  };
  let cooldownTicker;
  const startCooldown = (seconds) => {
    state.codeCooldownUntil = Date.now() + seconds * 1000;
    refreshCodeBtn();
    clearInterval(cooldownTicker);
    cooldownTicker = setInterval(() => {
      refreshCodeBtn();
      if (Date.now() >= state.codeCooldownUntil) clearInterval(cooldownTicker);
    }, 1000);
  };
  refreshCodeBtn();

  codeBtn.addEventListener("click", async () => {
    err.textContent = ""; info.textContent = "";
    state.email = emailIn.value.trim();
    if (!state.email) { err.textContent = "先填邮箱"; return; }
    codeBtn.disabled = true;
    codeBtn.textContent = "验证中…";
    try {
      const pow = await runPow((n) => (powp.textContent = `算力验证：${n}`));
      codeBtn.textContent = "发送中…";
      const res = await apiPost("/api/register/send-code", { email: state.email, pow });
      powp.textContent = "";
      if (res.error) {
        err.textContent = errMsg(res.error, res);
        codeBtn.disabled = false;
        codeBtn.textContent = "获取验证码";
      } else {
        info.textContent = "验证码已发送，10 分钟内有效";
        startCooldown(60);
      }
    } catch (e) {
      err.textContent = String(e.message || e);
      codeBtn.disabled = false;
      codeBtn.textContent = "获取验证码";
      powp.textContent = "";
    }
  });

  submit.addEventListener("click", async () => {
    err.textContent = ""; info.textContent = "";
    state.email = emailIn.value.trim();
    const code = codeIn.value.trim();
    if (!state.email) { err.textContent = "填邮箱"; return; }
    if (!/^\d{6}$/.test(code)) { err.textContent = "验证码是 6 位数字"; return; }
    if (pw1.value.length < 8) { err.textContent = "密码至少 8 位"; return; }
    if (pw1.value !== pw2.value) { err.textContent = "两次密码不一致"; return; }
    submit.disabled = true;
    submit.textContent = "验证中…";
    try {
      const pow = await runPow((n) => (powp.textContent = `算力验证：${n}`));
      submit.textContent = "提交中…";
      const res = await apiPost("/api/register/verify", {
        email: state.email, code, password: pw1.value, pow,
      });
      if (res.error) {
        err.textContent = errMsg(res.error, res);
      } else {
        powp.textContent = "";
        onSuccess(res);
        return;
      }
    } catch (e) {
      err.textContent = String(e.message || e);
    }
    submit.disabled = false;
    submit.textContent = "注册并登录";
    powp.textContent = "";
  });

  body.append(
    el("label", {}, "邮箱"), emailIn,
    el("label", {}, "验证码"), codeRow,
    el("label", {}, "设置密码（≥ 8 位）"), pw1,
    el("label", {}, "再输一遍"), pw2,
    err, info, powp, submit,
  );
}

function errMsg(code, res) {
  return ({
    invalid_email: "邮箱格式不对",
    invalid_password: "密码至少 8 位",
    invalid_pow: "算力验证失败，刷新页面重试",
    email_taken: "邮箱已注册，去登录吧",
    mail_failed: "邮件发送失败，稍后重试",
    bad_credentials: "邮箱或密码错误",
    locked: `登录失败太多，请 ${Math.ceil((res?.retry_after || 0) / 60000)} 分钟后再试`,
    not_activated: "账号未激活，请重新注册并完成验证",
    invalid_code: "验证码格式错误（6 位数字）",
    code_not_found: "没找到验证码，请先点「获取验证码」",
    code_expired: "验证码已过期，请重新获取",
    code_wrong: res?.attempts_left != null ? `验证码错误，还剩 ${res.attempts_left} 次机会` : "验证码错误",
    code_too_many_attempts: "尝试次数过多，请重新获取验证码",
    resend_cooldown: `请 ${res?.retry_after_seconds || 60} 秒后重试`,
  })[code] || code || "出错了";
}

export async function fetchMe() {
  return apiGet("/api/me");
}

export async function logout() {
  return apiPost("/api/logout", {});
}
