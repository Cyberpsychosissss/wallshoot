// Button-driven input. Hold a direction button to send a continuous
// intent to the server; release to stop. Posture / fire are tap actions.
//
// Same code path on desktop (mouse) and touch — uses Pointer Events.

const HOLD_BUTTONS = []; // active hold-button bindings (for cleanup)

function bindHold(btn, onDown, onUp) {
  if (!btn) return;
  let activePointer = null;
  const release = () => {
    if (activePointer === null) return;
    activePointer = null;
    btn.classList.remove("pressed");
    onUp();
  };
  const down = (e) => {
    if (activePointer !== null) return;
    activePointer = e.pointerId ?? "mouse";
    try { btn.setPointerCapture(e.pointerId); } catch {}
    btn.classList.add("pressed");
    onDown();
    e.preventDefault();
  };
  const up = (e) => {
    if (activePointer === null) return;
    // Only release for the same pointer that started the press.
    if (e.pointerId !== undefined && activePointer !== "mouse" && e.pointerId !== activePointer) return;
    release();
    e.preventDefault?.();
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  // Catch a release that happens off the button (finger slid out, window
  // blur, scroll-driven cancel, etc). Critical: pointerleave is NOT bound
  // here — leaving the button's bounding box does NOT release the press.
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("blur", release);
  HOLD_BUTTONS.push({ btn, down, up });
}

function bindTap(btn, onTap) {
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    onTap();
    e.preventDefault();
  });
}

export function attachButtonInput({ sendInput, getState }) {
  // Shooter aim buttons
  bindHold(document.getElementById("btn-aim-up"),
    () => sendInput({ aim_dy: -1 }),
    () => sendInput({ aim_dy: 0 }));
  bindHold(document.getElementById("btn-aim-down"),
    () => sendInput({ aim_dy: 1 }),
    () => sendInput({ aim_dy: 0 }));
  bindHold(document.getElementById("btn-aim-left"),
    () => sendInput({ aim_dx: -1 }),
    () => sendInput({ aim_dx: 0 }));
  bindHold(document.getElementById("btn-aim-right"),
    () => sendInput({ aim_dx: 1 }),
    () => sendInput({ aim_dx: 0 }));
  bindTap(document.getElementById("btn-fire"),
    () => sendInput({ fire: true }));

  // Hider move + posture
  bindHold(document.getElementById("btn-move-left"),
    () => sendInput({ move: -1 }),
    () => sendInput({ move: 0 }));
  bindHold(document.getElementById("btn-move-right"),
    () => sendInput({ move: 1 }),
    () => sendInput({ move: 0 }));
  // Three explicit posture buttons + jump / dodge actions
  bindTap(document.getElementById("btn-stand"), () => sendInput({ posture: "stand" }));
  bindTap(document.getElementById("btn-crouch"), () => sendInput({ posture: "crouch" }));
  bindTap(document.getElementById("btn-prone"), () => sendInput({ posture: "prone" }));
  bindTap(document.getElementById("btn-jump"), () => sendInput({ action: "jump" }));
  bindTap(document.getElementById("btn-dodge"), () => {
    const state = getState();
    if (!state) return;
    // Direction follows current movement input; defaults to left.
    const me = state.players[state.viewerIdx];
    // Last move dir is stored as moveDir on server; for local UX we look at
    // whether the player is currently holding left or right. If neither, pick
    // the side they're closer to the center from.
    const heldLeft  = document.getElementById("btn-move-left")?.classList.contains("pressed");
    const heldRight = document.getElementById("btn-move-right")?.classList.contains("pressed");
    const dir = heldLeft ? "dodge_left"
              : heldRight ? "dodge_right"
              : (me.anchorCol >= 6 ? "dodge_left" : "dodge_right");
    sendInput({ action: dir });
  });

  // Keyboard fallback for desktop power users (optional convenience).
  let downKeys = new Set();
  const handleKey = (e, down) => {
    const k = e.code;
    const state = getState();
    if (!state) return;
    const isShooter = state.viewerIdx === state.shooterIdx;
    if (down && downKeys.has(k)) return;
    if (down) downKeys.add(k); else downKeys.delete(k);

    if (isShooter) {
      if (k === "ArrowLeft") sendInput({ aim_dx: down ? -1 : 0 });
      else if (k === "ArrowRight") sendInput({ aim_dx: down ? 1 : 0 });
      else if (k === "ArrowUp") sendInput({ aim_dy: down ? -1 : 0 });
      else if (k === "ArrowDown") sendInput({ aim_dy: down ? 1 : 0 });
      else if (down && (k === "Space" || k === "Enter")) sendInput({ fire: true });
    } else {
      if (k === "KeyA" || k === "ArrowLeft") sendInput({ move: down ? -1 : 0 });
      else if (k === "KeyD" || k === "ArrowRight") sendInput({ move: down ? 1 : 0 });
      else if (down && k === "KeyW") sendInput({ posture: "stand" });
      else if (down && k === "KeyS") sendInput({ posture: "crouch" });
      else if (down && k === "KeyZ") sendInput({ posture: "prone" });
      else if (down && k === "Space") sendInput({ action: "jump" });
      else if (down && (k === "KeyQ" || k === "KeyE")) {
        sendInput({ action: k === "KeyQ" ? "dodge_left" : "dodge_right" });
      }
    }
  };
  window.addEventListener("keydown", (e) => handleKey(e, true));
  window.addEventListener("keyup", (e) => handleKey(e, false));
}
