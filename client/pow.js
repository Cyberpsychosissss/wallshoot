// Solve a Proof-of-Work challenge issued by the server.
// Runs in a Web Worker to keep the UI responsive.
//
// Spec: find a nonce string such that
//   sha256(challenge + nonce) has `difficulty` leading zero bits (hex form).

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
  return hex;
}

function hasLeadingZeroBits(hex, bits) {
  let need = bits;
  for (let i = 0; i < hex.length && need > 0; i++) {
    const nibble = parseInt(hex[i], 16);
    if (need >= 4) {
      if (nibble !== 0) return false;
      need -= 4;
    } else {
      const mask = 0xf << (4 - need);
      return (nibble & mask) === 0;
    }
  }
  return need <= 0;
}

async function solve(challenge, difficulty, onProgress) {
  let nonce = 0;
  const t0 = performance.now();
  while (true) {
    const candidate = nonce.toString(36);
    const hex = await sha256Hex(challenge + candidate);
    if (hasLeadingZeroBits(hex, difficulty)) {
      return { nonce: candidate, attempts: nonce + 1, ms: performance.now() - t0 };
    }
    nonce++;
    if (nonce % 500 === 0 && onProgress) onProgress(nonce);
  }
}

if (typeof window === "undefined" && typeof self !== "undefined") {
  // Web Worker path
  self.onmessage = async (e) => {
    const { challenge, difficulty } = e.data;
    try {
      const res = await solve(challenge, difficulty, (n) =>
        self.postMessage({ type: "progress", attempts: n }),
      );
      self.postMessage({ type: "done", ...res });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  };
} else if (typeof window !== "undefined") {
  // Main-thread helper for callers
  window.solvePow = async function ({ id, challenge, difficulty }, onProgress) {
    const w = new Worker(`${window.__BASE__ || ""}/pow.js`);
    return new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        if (e.data.type === "progress") onProgress?.(e.data.attempts);
        else if (e.data.type === "done") {
          w.terminate();
          resolve({ id, nonce: e.data.nonce, ms: e.data.ms });
        } else if (e.data.type === "error") {
          w.terminate();
          reject(new Error(e.data.message));
        }
      };
      w.onerror = (err) => {
        w.terminate();
        reject(err);
      };
      w.postMessage({ challenge, difficulty });
    });
  };
}
