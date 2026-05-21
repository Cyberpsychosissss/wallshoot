// Unified input layer — emits "intent" objects, never raw events.
//
// For the shooter, aim_col/aim_row use wall-grid coordinates;
// the renderer converts screen → grid via renderer.aimFromScreen().

export function attachInput(canvas, renderer, { sendInput, getState }) {
  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("is-touch");

  // ── Shared shooter aim helpers ──
  function emitAim(clientX, clientY) {
    const state = getState();
    if (!state || state.shooterIdx !== state.viewerIdx) return;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const aim = renderer.aimFromScreen(state, sx, sy);
    sendInput(aim);
  }

  // ── Mouse / keyboard ──
  canvas.addEventListener("mousemove", (e) => {
    if (isTouch) return;
    emitAim(e.clientX, e.clientY);
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isTouch) return;
    sendInput({ fire: true });
  });

  let moveDir = 0;
  function pushMove() {
    sendInput({ move: moveDir });
  }
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const state = getState();
    if (!state) return;
    if (e.code === "KeyA" || e.code === "ArrowLeft") {
      moveDir = -1; pushMove();
    } else if (e.code === "KeyD" || e.code === "ArrowRight") {
      moveDir = 1; pushMove();
    } else if (e.code === "KeyW" || e.code === "ArrowUp") {
      sendInput({ posture: "stand" });
    } else if (e.code === "KeyS" || e.code === "ArrowDown") {
      // Cycle stand → crouch → prone → stand
      const me = state.players[state.viewerIdx];
      const next = me.posture === "stand" ? "crouch" : me.posture === "crouch" ? "prone" : "stand";
      sendInput({ posture: next });
    } else if (e.code === "Space" || e.code === "Enter") {
      sendInput({ fire: true });
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyA" || e.code === "ArrowLeft") {
      if (moveDir === -1) { moveDir = 0; pushMove(); }
    } else if (e.code === "KeyD" || e.code === "ArrowRight") {
      if (moveDir === 1) { moveDir = 0; pushMove(); }
    }
  });

  // ── Touch ──
  let lastTouchX = null, lastTouchY = null, touchStartX = 0, touchStartY = 0, touchStartTime = 0;
  let activeTouchId = null;
  let lastTap = 0;
  const TAP_MAX_MS = 220;
  const DOUBLE_TAP_MS = 320;
  const SWIPE_MIN_PX = 30;

  canvas.addEventListener("touchstart", (e) => {
    if (activeTouchId !== null) return;
    const t = e.changedTouches[0];
    activeTouchId = t.identifier;
    touchStartX = t.clientX; touchStartY = t.clientY;
    lastTouchX = t.clientX; lastTouchY = t.clientY;
    touchStartTime = Date.now();
    const state = getState();
    if (state && state.viewerIdx === state.shooterIdx) {
      emitAim(t.clientX, t.clientY);
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    let t = null;
    for (const tt of e.changedTouches) if (tt.identifier === activeTouchId) { t = tt; break; }
    if (!t) return;
    const state = getState();
    if (!state) return;
    if (state.viewerIdx === state.shooterIdx) {
      emitAim(t.clientX, t.clientY);
    }
    lastTouchX = t.clientX; lastTouchY = t.clientY;
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    let t = null;
    for (const tt of e.changedTouches) if (tt.identifier === activeTouchId) { t = tt; break; }
    if (!t) return;
    activeTouchId = null;
    const dt = Date.now() - touchStartTime;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dist = Math.hypot(dx, dy);
    const state = getState();
    if (!state) return;

    const isShooter = state.viewerIdx === state.shooterIdx;
    if (isShooter) {
      // Double-tap to fire
      if (dt < TAP_MAX_MS && dist < 12) {
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          sendInput({ fire: true });
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
    } else {
      // Hider — interpret swipe
      if (dist > SWIPE_MIN_PX) {
        if (Math.abs(dx) > Math.abs(dy)) {
          // left/right → step move
          sendInput({ move: dx > 0 ? 1 : -1 });
          setTimeout(() => sendInput({ move: 0 }), 180);
        } else {
          // up/down → cycle posture
          const me = state.players[state.viewerIdx];
          let next;
          if (dy < 0) {
            // up: stand up
            next = me.posture === "prone" ? "crouch" : "stand";
          } else {
            // down: lower
            next = me.posture === "stand" ? "crouch" : "prone";
          }
          if (next !== me.posture) sendInput({ posture: next });
        }
      }
    }
    e.preventDefault();
  }, { passive: false });

  // Big "FIRE" button for touch shooters
  const fireBtn = document.querySelector(".touch-fire-btn");
  if (fireBtn) {
    fireBtn.addEventListener("click", (e) => {
      sendInput({ fire: true });
      e.stopPropagation();
    });
    fireBtn.addEventListener("touchend", (e) => {
      sendInput({ fire: true });
      e.preventDefault();
      e.stopPropagation();
    });
  }
}
