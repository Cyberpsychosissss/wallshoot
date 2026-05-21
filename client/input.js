// Button-driven input. Hold a direction button to send a continuous
// intent to the server; release to stop. Posture / fire are tap actions.
//
// Same code path on desktop (mouse) and touch — uses Pointer Events.

const HOLD_BUTTONS = []; // active hold-button bindings (for cleanup)

function bindHold(btn, onDown, onUp) {
  if (!btn) return;
  let pointerId = null;
  const down = (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId ?? "mouse";
    try { btn.setPointerCapture(e.pointerId); } catch {}
    btn.classList.add("pressed");
    onDown();
    e.preventDefault();
  };
  const up = (e) => {
    if (pointerId === null) return;
    pointerId = null;
    btn.classList.remove("pressed");
    onUp();
    e.preventDefault();
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
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
  bindTap(document.getElementById("btn-posture"),
    () => {
      const state = getState();
      if (!state) return;
      const me = state.players[state.viewerIdx];
      const next = me.posture === "stand" ? "crouch"
                : me.posture === "crouch" ? "prone"
                : "stand";
      sendInput({ posture: next });
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
      else if (down && (k === "KeyS" || k === "Space")) {
        const me = state.players[state.viewerIdx];
        const next = me.posture === "stand" ? "crouch"
                  : me.posture === "crouch" ? "prone"
                  : "stand";
        sendInput({ posture: next });
      }
    }
  };
  window.addEventListener("keydown", (e) => handleKey(e, true));
  window.addEventListener("keyup", (e) => handleKey(e, false));
}
