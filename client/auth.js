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
  Object.assign(e, props);
  for (const c of children) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function renderLogin(mount, { onSuccess, switchTo }) {
  mount.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card" });
  card.append(
    el("h1", {}, "Wallshoot"),
    el("p", { className: "sub" }, "登录开打"),
    el("label", {}, "邮箱"),
    Object.assign(el("input"), { type: "email", id: "email", autocomplete: "email" }),
    el("label", {}, "密码"),
    Object.assign(el("input"), { type: "password", id: "password", autocomplete: "current-password" }),
    el("div", { className: "error-msg", id: "err" }),
    el("div", { className: "pow-progress", id: "powp" }),
    el("div", { className: "row-buttons" },
      Object.assign(el("button", { id: "submit" }), { textContent: "登录" }),
      Object.assign(el("button", { className: "secondary", id: "toReg" }), { textContent: "注册" }),
    ),
  );
  screen.append(card);
  mount.append(screen);

  const errEl = card.querySelector("#err");
  const powp = card.querySelector("#powp");
  const submit = card.querySelector("#submit");
  card.querySelector("#toReg").onclick = () => switchTo("register");

  submit.onclick = async () => {
    errEl.textContent = "";
    const email = card.querySelector("#email").value.trim();
    const password = card.querySelector("#password").value;
    if (!email || !password) {
      errEl.textContent = "填邮箱和密码";
      return;
    }
    submit.disabled = true;
    submit.textContent = "验证中…";
    try {
      const pow = await runPow((n) => (powp.textContent = `算力验证：${n}`));
      submit.textContent = "登录中…";
      const res = await apiPost("/api/login", { email, password, pow });
      if (res.error) {
        errEl.textContent = errMsg(res.error, res);
      } else {
        powp.textContent = "";
        onSuccess(res);
      }
    } catch (e) {
      errEl.textContent = String(e.message || e);
    }
    submit.disabled = false;
    submit.textContent = "登录";
    powp.textContent = "";
  };
}

export function renderRegister(mount, { onSuccess, switchTo }) {
  mount.innerHTML = "";
  const screen = el("div", { className: "center-screen" });
  const card = el("div", { className: "card" });
  card.append(
    el("h1", {}, "Wallshoot"),
    el("p", { className: "sub" }, "新账号 — 邮箱激活后即可游戏"),
    el("label", {}, "邮箱"),
    Object.assign(el("input"), { type: "email", id: "email", autocomplete: "email" }),
    el("label", {}, "密码（≥ 8 位）"),
    Object.assign(el("input"), { type: "password", id: "password", autocomplete: "new-password" }),
    el("div", { className: "error-msg", id: "err" }),
    el("div", { className: "info-msg", id: "info" }),
    el("div", { className: "pow-progress", id: "powp" }),
    el("div", { className: "row-buttons" },
      Object.assign(el("button", { id: "submit" }), { textContent: "注册" }),
      Object.assign(el("button", { className: "secondary", id: "toLogin" }), { textContent: "登录" }),
    ),
  );
  screen.append(card);
  mount.append(screen);

  const errEl = card.querySelector("#err");
  const infoEl = card.querySelector("#info");
  const powp = card.querySelector("#powp");
  const submit = card.querySelector("#submit");
  card.querySelector("#toLogin").onclick = () => switchTo("login");

  submit.onclick = async () => {
    errEl.textContent = "";
    infoEl.textContent = "";
    const email = card.querySelector("#email").value.trim();
    const password = card.querySelector("#password").value;
    if (!email || !password) {
      errEl.textContent = "填邮箱和密码";
      return;
    }
    if (password.length < 8) {
      errEl.textContent = "密码至少 8 位";
      return;
    }
    submit.disabled = true;
    submit.textContent = "验证中…";
    try {
      const pow = await runPow((n) => (powp.textContent = `算力验证：${n}`));
      submit.textContent = "提交中…";
      const res = await apiPost("/api/register", { email, password, pow });
      if (res.error) {
        errEl.textContent = errMsg(res.error, res);
      } else {
        infoEl.textContent = "已发送激活邮件，请检查收件箱（可能在垃圾邮件）。";
        powp.textContent = "";
      }
    } catch (e) {
      errEl.textContent = String(e.message || e);
    }
    submit.disabled = false;
    submit.textContent = "注册";
    powp.textContent = "";
  };
}

function errMsg(code, res) {
  switch (code) {
    case "invalid_email": return "邮箱格式不对";
    case "invalid_password": return "密码格式不对（≥ 8 位）";
    case "invalid_pow": return "验证失败，刷新重试";
    case "email_taken": return "邮箱已注册";
    case "mail_failed": return "邮件发送失败，稍后重试";
    case "bad_credentials": return "邮箱或密码错误";
    case "locked": return `登录失败次数过多，请 ${Math.ceil((res?.retry_after || 0) / 60000)} 分钟后再试`;
    case "not_activated": return "账号未激活，去邮箱点激活链接";
    default: return code || "出错了";
  }
}

export async function fetchMe() {
  return apiGet("/api/me");
}

export async function logout() {
  return apiPost("/api/logout", {});
}
