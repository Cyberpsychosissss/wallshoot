import { REPLAY_BUFFER_TICKS } from "./constants.js";

export function createBuffer() {
  return { frames: [], head: 0 };
}

export function pushFrame(buf, frame) {
  if (buf.frames.length < REPLAY_BUFFER_TICKS) {
    buf.frames.push(frame);
  } else {
    buf.frames[buf.head] = frame;
    buf.head = (buf.head + 1) % REPLAY_BUFFER_TICKS;
  }
}

export function snapshot(buf) {
  if (buf.frames.length < REPLAY_BUFFER_TICKS) return buf.frames.slice();
  const out = [];
  for (let i = 0; i < REPLAY_BUFFER_TICKS; i++) {
    out.push(buf.frames[(buf.head + i) % REPLAY_BUFFER_TICKS]);
  }
  return out;
}

export function clearBuffer(buf) {
  buf.frames.length = 0;
  buf.head = 0;
}
