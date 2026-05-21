// Synthesised sound effects via Web Audio API — no asset files needed.
//
// Sounds are tiny utility blips generated on the fly.

let ctx = null;
let muted = false;

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function envelope(gainNode, t, { attack = 0.005, decay = 0.08, peak = 0.7 }) {
  gainNode.gain.setValueAtTime(0, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function setMuted(v) { muted = !!v; }

export const audio = {
  click() {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square"; o.frequency.value = 880;
    o.connect(g).connect(c.destination);
    envelope(g, t, { attack: 0.002, decay: 0.05, peak: 0.2 });
    o.start(t); o.stop(t + 0.06);
  },
  step() {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle"; o.frequency.value = 220;
    o.connect(g).connect(c.destination);
    envelope(g, t, { attack: 0.003, decay: 0.05, peak: 0.12 });
    o.start(t); o.stop(t + 0.06);
  },
  fire() {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    // noise burst + low thud
    const noise = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    noise.buffer = buf;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    noise.connect(ng).connect(c.destination);
    noise.start(t);

    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    o.connect(g).connect(c.destination);
    envelope(g, t, { attack: 0.001, decay: 0.12, peak: 0.5 });
    o.start(t); o.stop(t + 0.15);
  },
  wallBreak() {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const noise = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.4);
    noise.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass"; filter.frequency.value = 1200; filter.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    noise.connect(filter).connect(g).connect(c.destination);
    noise.start(t);
  },
  hit(part) {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(part === "head" ? 600 : part === "torso" ? 200 : 320, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    o.connect(g).connect(c.destination);
    envelope(g, t, { attack: 0.001, decay: 0.2, peak: 0.6 });
    o.start(t); o.stop(t + 0.22);
  },
  whoosh() {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const noise = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    noise.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
    noise.connect(filter).connect(g).connect(c.destination);
    noise.start(t);
  },
};

export function unlockAudio() { ensureCtx(); }
