// Lightweight wrapper around the Socket.IO client (loaded from CDN).
//
// Adds the SUBPATH-aware socket.io path so the same code works locally
// (no prefix) and behind NPM's path rewrite (where the browser hits
// /wallshoot/socket.io but the backend sees /socket.io).

const BASE = window.__BASE__ || "";

export async function loadIO() {
  if (window.io) return window.io;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/dist/socket.io.min.js";
    s.onload = res;
    s.onerror = () => rej(new Error("failed to load socket.io"));
    document.head.appendChild(s);
  });
  return window.io;
}

export async function connect() {
  const io = await loadIO();
  const path = `${BASE}/socket.io`;
  // Same-origin connection — let socket.io derive the URL from window.location
  const sock = io({
    path,
    transports: ["websocket", "polling"],
    autoConnect: true,
    withCredentials: true,
    // Reconnect aggressively for the first ~30 seconds; the server's grace
    // window is 30s, so there's no point retrying beyond that.
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 800,
    reconnectionDelayMax: 2500,
    randomizationFactor: 0.4,
  });
  return sock;
}

export async function apiPost(path, body, csrf) {
  const headers = { "Content-Type": "application/json" };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify(body || {}),
  });
  return res.json().catch(() => ({ error: "bad_response" }));
}

export async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
  });
  return res.json().catch(() => ({ error: "bad_response" }));
}
