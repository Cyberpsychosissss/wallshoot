// Mirror of server/stickman.js — keep these in sync. Grid is 12 cols × 12 rows.
const POSTURE_BLOCKS = {
  stand: [
    { rows: [0, 1], cols: [-1, 1], part: "head" },
    { rows: [2, 6], cols: [-1, 1], part: "torso" },
    { rows: [7, 11], cols: [-1, 1], part: "limb" },
  ],
  crouch: [
    { rows: [3, 4], cols: [-1, 1], part: "head" },
    { rows: [5, 8], cols: [-1, 1], part: "torso" },
    { rows: [9, 11], cols: [-1, 1], part: "limb" },
  ],
  prone: [
    { rows: [10, 11], cols: [-4, -3], part: "head" },
    { rows: [10, 11], cols: [-2, 2], part: "torso" },
    { rows: [10, 11], cols: [3, 4], part: "limb" },
  ],
};

function bodyCellsAt(anchorCol, posture) {
  const blocks = POSTURE_BLOCKS[posture] || POSTURE_BLOCKS.stand;
  const out = [];
  const anchor = Math.round(anchorCol);
  for (const b of blocks) {
    for (let r = b.rows[0]; r <= b.rows[1]; r++) {
      for (let dc = b.cols[0]; dc <= b.cols[1]; dc++) {
        out.push({ col: anchor + dc, row: r, part: b.part });
      }
    }
  }
  return out;
}

const PART_FILLS = {
  head: "#ffb59a",
  torso: "#3a5fa0",
  limb: "#2c4373",
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let lastState = null;
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  // ── Compute wall placement for the current viewer ─────────────────────
  // The "core" 12×12 grid is the playable area. Decorative bricks extend
  // both sides off-screen so the wall feels long. Vertical position differs
  // between shooter (far / small) and hider (close / large).
  function wallLayout(state) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const isShooter = state.isShooterView;
    // Target wall dimensions by both height *and* width — pick whichever
    // is smaller so the wall always fits (especially in portrait).
    let targetH, targetWFrac, topYFrac;
    if (isShooter) {
      targetH = H * 0.22;
      targetWFrac = 0.55;   // shooter wall stays narrow even on wide screens
      topYFrac = 0.38;
    } else {
      targetH = H * 0.58;
      targetWFrac = 0.85;   // hider wall fills most of the width
      topYFrac = 0.30;
    }
    const cellByH = targetH / 12;
    const cellByW = (W * targetWFrac) / 12;
    const cellSize = Math.min(cellByH, cellByW);
    const coreW = cellSize * 12;
    const coreH = cellSize * 12;
    const wallLeftX = (W - coreW) / 2;
    const wallTopY = H * topYFrac;
    return {
      cellW: cellSize, cellH: cellSize,
      wallLeftX, wallTopY,
      wallRightX: wallLeftX + coreW,
      wallBottomY: wallTopY + coreH,
      W, H,
    };
  }

  function decodeWall(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function draw(state) {
    lastState = state;
    const W = canvas.clientWidth, H = canvas.clientHeight;

    // ── Background: sky + ground ──
    drawBackdrop(state, W, H);

    const L = wallLayout(state);
    const wallData = decodeWall(state.wall);
    const oppIdx = 1 - state.viewerIdx;
    const opp = state.players[oppIdx];

    // ── Opponent silhouette (hider only — sees the shooter in the distance) ──
    if (!state.isShooterView && (state.phase === "battle" || state.phase === "prep")) {
      drawDistantShooter(L, opp, state);
    }

    // ── The wall (core bricks + decorative side bricks) ──
    drawWall(L, wallData, state);

    // ── Laser dot on the wall + shooter's beam ──
    if (state.phase === "battle" || state.phase === "prep") {
      const shooter = state.players[state.shooterIdx];
      drawLaser(L, shooter, state);
    }

    // ── Self stickman (back view, foreground) ──
    drawSelfStickman(L, state);

    // ── Prep overlay for shooter only ──
    if (state.phase === "prep" && state.isShooterView) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("对方准备中…", W / 2, H / 2 - 20);
      if (state.timer != null) {
        ctx.font = "bold 48px ui-monospace, monospace";
        ctx.fillStyle = "#ffb300";
        ctx.fillText(`${Math.ceil(state.timer)}s`, W / 2, H / 2 + 30);
      }
    }
  }

  // ── Drawing helpers ───────────────────────────────────────────────────

  function drawBackdrop(state, W, H) {
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, "#0c1218");
    sky.addColorStop(0.6, "#1a2330");
    sky.addColorStop(1, "#2a2620");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Ground
    const ground = ctx.createLinearGradient(0, H * 0.7, 0, H);
    ground.addColorStop(0, "#1f1a16");
    ground.addColorStop(1, "#0a0807");
    ctx.fillStyle = ground;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
    // Distant horizon line — sits where the wall meets the ground in the
    // shooter view (perspective hint)
    const horizonY = state.isShooterView ? H * 0.50 : H * 0.32;
    ctx.strokeStyle = "rgba(120,80,60,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(W, horizonY);
    ctx.stroke();
  }

  function drawWall(L, wallData, state) {
    const { cellW, cellH, wallLeftX, wallTopY, W } = L;
    const coreCols = 12, coreRows = 12;
    // Decorative bricks on each side — enough to cover the canvas.
    const sideColsNeeded = Math.ceil((wallLeftX / cellW)) + 2;

    for (let r = 0; r < coreRows; r++) {
      // Running bond: every other row offset by half a brick width.
      const offset = (r % 2 === 0) ? 0 : cellW * 0.5;
      for (let c = -sideColsNeeded; c < coreCols + sideColsNeeded; c++) {
        const x = wallLeftX + c * cellW + offset;
        const y = wallTopY + r * cellH;
        if (x + cellW < -2 || x > W + 2) continue; // skip way off-screen
        const isDecorative = c < 0 || c >= coreCols;
        const isHole = !isDecorative && wallData[r * coreCols + c] === 1;
        if (isHole) {
          drawHole(x, y, cellW, cellH, c, r, state);
        } else {
          drawBrick(x, y, cellW, cellH, c, r, isDecorative);
        }
      }
    }

    // Subtle vignette on the decorative edges so the wall fades into distance
    const fadeW = Math.min(L.wallLeftX, 120);
    if (fadeW > 0) {
      const lg = ctx.createLinearGradient(0, 0, fadeW, 0);
      lg.addColorStop(0, "rgba(8,10,14,0.7)");
      lg.addColorStop(1, "rgba(8,10,14,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, wallTopY - 4, fadeW, cellH * coreRows + 8);
      const rg = ctx.createLinearGradient(W - fadeW, 0, W, 0);
      rg.addColorStop(0, "rgba(8,10,14,0)");
      rg.addColorStop(1, "rgba(8,10,14,0.7)");
      ctx.fillStyle = rg;
      ctx.fillRect(W - fadeW, wallTopY - 4, fadeW, cellH * coreRows + 8);
    }
  }

  function drawBrick(x, y, w, h, col, row, decorative) {
    // Deterministic per-brick colour jitter — keeps the wall lively
    // without changing every frame.
    const seed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const jitter = ((seed % 17) - 8); // -8..+8
    const baseL = decorative ? 28 : 36;
    const L = Math.max(18, Math.min(58, baseL + jitter * 0.6));
    const H = 14 + ((seed >>> 4) % 8); // hue 14..22
    const S = 28 + ((seed >>> 8) % 14); // sat 28..42
    ctx.fillStyle = `hsl(${H},${S}%,${L}%)`;
    ctx.fillRect(x, y, w, h);
    // Highlight (top edge)
    ctx.fillStyle = `hsla(${H},${S}%,${Math.min(80, L + 18)}%,0.35)`;
    ctx.fillRect(x, y, w, Math.max(1, h * 0.12));
    // Shadow (bottom edge)
    ctx.fillStyle = `hsla(${H},${S}%,${Math.max(8, L - 16)}%,0.4)`;
    ctx.fillRect(x, y + h - Math.max(1, h * 0.12), w, Math.max(1, h * 0.12));
    // Mortar lines (left + top)
    ctx.fillStyle = "rgba(220,210,200,0.18)";
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y, 1, h);
  }

  function drawHole(x, y, w, h, col, row, state) {
    // For shooter view, holes peer onto open ground / nothing (the hider is
    // pressed flat against the far side, can't be seen even through the hole
    // unless aim aligns with their body — which the brick hit-test already
    // handles via wall data). Render holes as dark, jagged rim.
    const isShooter = state.isShooterView;
    // Background through the hole
    if (isShooter) {
      ctx.fillStyle = "#06080a";
      ctx.fillRect(x, y, w, h);
    } else {
      // For hider, a hole reveals the shooter side — slightly lighter
      // (distant outdoor light)
      ctx.fillStyle = "#1c2530";
      ctx.fillRect(x, y, w, h);
      // Show the opponent's silhouette through this hole if aligned
      const opp = state.players[state.shooterIdx];
      const cells = bodyCellsAt(opp.anchorCol, opp.posture);
      const match = cells.find((p) => p.col === col && p.row === row);
      if (match) {
        ctx.fillStyle = PART_FILLS[match.part];
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      }
    }
    // Jagged rim — random offsets to suggest broken brick edges
    ctx.strokeStyle = "rgba(60,40,30,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const seed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const offsets = [
      [(seed % 5) - 2, ((seed >>> 4) % 5) - 2],
      [((seed >>> 8) % 5) - 2, ((seed >>> 12) % 5) - 2],
      [((seed >>> 16) % 5) - 2, ((seed >>> 20) % 5) - 2],
      [((seed >>> 24) % 5) - 2, ((seed >>> 2) % 5) - 2],
    ];
    ctx.moveTo(x + offsets[0][0], y + offsets[0][1]);
    ctx.lineTo(x + w + offsets[1][0], y + offsets[1][1]);
    ctx.lineTo(x + w + offsets[2][0], y + h + offsets[2][1]);
    ctx.lineTo(x + offsets[3][0], y + h + offsets[3][1]);
    ctx.closePath();
    ctx.stroke();
  }

  function drawDistantShooter(L, shooter, state) {
    // Render the shooter as a small silhouette above the wall — distant.
    const { W, H } = L;
    const cx = W / 2 + (shooter.aim.col - 6) * 6; // shooter aim shifts position slightly
    const baseY = L.wallTopY - 4;
    const scale = 0.55;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#1a1a1a";
    ctx.strokeStyle = "#cc4444";
    ctx.lineWidth = 2;
    const bodyH = 56 * scale;
    const headR = 11 * scale;
    // legs
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx - 8 * scale, baseY - bodyH * 0.4);
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx + 8 * scale, baseY - bodyH * 0.4);
    ctx.stroke();
    // torso
    ctx.beginPath();
    ctx.moveTo(cx, baseY - bodyH * 0.4);
    ctx.lineTo(cx, baseY - bodyH);
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.arc(cx, baseY - bodyH - headR, headR, 0, Math.PI * 2);
    ctx.fillStyle = "#cc4444";
    ctx.fill();
    ctx.stroke();
    // gun
    ctx.fillStyle = "#333";
    ctx.fillRect(cx + 8 * scale, baseY - bodyH + 4 * scale, 16 * scale, 4 * scale);
    ctx.restore();
  }

  function drawLaser(L, shooter, state) {
    const { cellW, cellH, wallLeftX, wallTopY } = L;
    const aimX = wallLeftX + (shooter.aim.col + 0.5) * cellW;
    const aimY = wallTopY + (shooter.aim.row + 0.5) * cellH;
    // Glow halo
    const halo = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, Math.max(cellW, cellH) * 1.3);
    halo.addColorStop(0, "rgba(255,40,40,0.85)");
    halo.addColorStop(0.5, "rgba(255,40,40,0.35)");
    halo.addColorStop(1, "rgba(255,40,40,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(aimX - cellW * 2, aimY - cellH * 2, cellW * 4, cellH * 4);
    // Bright core
    ctx.fillStyle = "#ff1f1f";
    ctx.beginPath();
    ctx.arc(aimX, aimY, Math.min(cellW, cellH) * 0.22, 0, Math.PI * 2);
    ctx.fill();

    if (state.phase === "battle") {
      // Solid laser line — visible to both sides. Shooter sees it from
      // their muzzle; hider sees the same beam shooting toward the wall
      // dot from where the distant shooter silhouette is drawn.
      const muzzle = state.isShooterView
        ? { x: L.W / 2 + 30, y: L.H * 0.78 }
        : muzzleFromDistantShooter(L, state);
      // Outer glow
      ctx.strokeStyle = "rgba(255,40,40,0.35)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      // Inner bright core
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      // White hot center streak
      ctx.strokeStyle = "rgba(255,220,220,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
  }

  function muzzleFromDistantShooter(L, state) {
    const { W } = L;
    const shooter = state.players[state.shooterIdx];
    const cx = W / 2 + (shooter.aim.col - 6) * 6;
    const baseY = L.wallTopY - 4;
    const scale = 0.55;
    const bodyH = 56 * scale;
    return { x: cx + 16 * scale, y: baseY - bodyH + 4 * scale };
  }

  function drawSelfStickman(L, state) {
    const { W, H } = L;
    const me = state.players[state.viewerIdx];
    const isShooter = state.isShooterView;
    const cx = W / 2;
    const baseY = H * 0.97;
    const scale = isShooter ? 1.4 : 1.55;
    const tintStroke = isShooter ? "#ff5252" : "#4fc3f7";
    const tintFill   = isShooter ? "#7a1f1f" : "#1e4d63";
    ctx.strokeStyle = tintStroke;
    ctx.fillStyle = tintFill;
    ctx.lineWidth = 3 * scale;

    if (me.posture === "prone") {
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 10 * scale, 70 * scale, 14 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    const bodyH = me.posture === "crouch" ? 60 * scale : 90 * scale;
    const headR = 17 * scale;
    const shoulderY = baseY - bodyH;
    // legs
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx - 14 * scale, baseY - bodyH * 0.4);
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx + 14 * scale, baseY - bodyH * 0.4);
    ctx.stroke();
    // torso
    ctx.beginPath();
    ctx.moveTo(cx, baseY - bodyH * 0.4);
    ctx.lineTo(cx, shoulderY);
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.arc(cx, shoulderY - headR, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // gun for shooter
    if (isShooter) {
      ctx.fillStyle = "#444";
      ctx.fillRect(cx + 14 * scale, shoulderY + 4 * scale, 28 * scale, 6 * scale);
      ctx.fillStyle = "#222";
      ctx.fillRect(cx + 38 * scale, shoulderY + 2 * scale, 4 * scale, 10 * scale);
    }
  }

  return {
    draw,
    get lastState() { return lastState; },
  };
}
