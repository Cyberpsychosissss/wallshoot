// Cartoon-style renderer:
//  - 12×12 brick wall in the middle ground
//  - Chunky alien-style characters (round head, round body, stubby legs)
//  - Isometric-ish floor + decorative pillars to flesh out the scene
//  - For the shooter, the screen is wrapped in a sniper-scope vignette
//    centered on the aim reticle, with a crosshair overlay.
//
// Mirror of server/stickman.js — keep posture blocks identical.

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

function actionShift(action, progress) {
  if (!action) return { rowShift: 0, colShift: 0, pixelDy: 0, pixelDx: 0 };
  if (action === "jump") {
    return {
      rowShift: -Math.round(Math.sin(progress * Math.PI) * 4),
      colShift: 0,
      pixelDy: -Math.sin(progress * Math.PI) * 48,
      pixelDx: 0,
    };
  }
  if (action === "dodge_left") {
    return {
      rowShift: 0,
      colShift: -Math.round(Math.sin(progress * Math.PI) * 3),
      pixelDy: 0,
      pixelDx: -Math.sin(progress * Math.PI) * 36,
    };
  }
  if (action === "dodge_right") {
    return {
      rowShift: 0,
      colShift: Math.round(Math.sin(progress * Math.PI) * 3),
      pixelDy: 0,
      pixelDx: Math.sin(progress * Math.PI) * 36,
    };
  }
  return { rowShift: 0, colShift: 0, pixelDy: 0, pixelDx: 0 };
}

function bodyCellsAt(anchorCol, posture, action, progress) {
  const blocks = POSTURE_BLOCKS[posture] || POSTURE_BLOCKS.stand;
  const { rowShift, colShift } = actionShift(action, progress);
  const out = [];
  const anchor = Math.round(anchorCol);
  for (const b of blocks) {
    for (let r = b.rows[0]; r <= b.rows[1]; r++) {
      for (let dc = b.cols[0]; dc <= b.cols[1]; dc++) {
        out.push({ col: anchor + dc + colShift, row: r + rowShift, part: b.part });
      }
    }
  }
  return out;
}

const PART_FILLS = {
  head: "#86d985",
  torso: "#4caf50",
  limb: "#388e3c",
};

const CHARACTER = {
  shooter: { body: "#e57373", outline: "#5a1818", face: "#ffccbc", eye: "#1a1a1a" },
  hider:   { body: "#7cd97a", outline: "#1f5a1f", face: "#c8e6c9", eye: "#1a1a1a" },
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

  function wallLayout(state) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const isShooter = state.isShooterView;
    let targetH, targetWFrac, topYFrac;
    if (isShooter) {
      targetH = H * 0.30;
      targetWFrac = 0.50;
      topYFrac = 0.32;
    } else {
      targetH = H * 0.55;
      targetWFrac = 0.85;
      topYFrac = 0.26;
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

    drawBackdrop(state, W, H);

    const L = wallLayout(state);
    const wallData = decodeWall(state.wall);
    const oppIdx = 1 - state.viewerIdx;
    const opp = state.players[oppIdx];

    drawFloor(L, state);
    drawPillars(L, state);

    if (!state.isShooterView && (state.phase === "battle" || state.phase === "prep")) {
      drawDistantShooter(L, opp, state);
    }

    drawWall(L, wallData, state);

    if (state.phase === "battle" || state.phase === "prep") {
      const shooter = state.players[state.shooterIdx];
      drawLaser(L, shooter, state);
    }

    drawSelfCharacter(L, state);

    // Shooter sees the world through a sniper scope
    if (state.isShooterView && state.phase === "battle") {
      const shooter = state.players[state.shooterIdx];
      const { cellW, cellH, wallLeftX, wallTopY } = L;
      const reticleX = wallLeftX + (shooter.aim.col + 0.5) * cellW;
      const reticleY = wallTopY + (shooter.aim.row + 0.5) * cellH;
      drawScopeVignette(W, H, reticleX, reticleY);
      drawCrosshair(reticleX, reticleY, Math.min(W, H) * 0.30);
    }

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

  // ── Backdrop / scene ───────────────────────────────────────────────────

  function drawBackdrop(state, W, H) {
    // Indoor blue room palette
    const wallY = state.isShooterView ? H * 0.32 : H * 0.26;
    // Sky / back wall
    const back = ctx.createLinearGradient(0, 0, 0, wallY + 40);
    back.addColorStop(0, "#1c3a5c");
    back.addColorStop(1, "#2c4f72");
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, W, wallY + 40);
    // Floor
    const floor = ctx.createLinearGradient(0, wallY + 40, 0, H);
    floor.addColorStop(0, "#1a2a3a");
    floor.addColorStop(0.5, "#28384a");
    floor.addColorStop(1, "#0d141c");
    ctx.fillStyle = floor;
    ctx.fillRect(0, wallY + 40, W, H);
  }

  function drawFloor(L, state) {
    const { W, H, wallBottomY } = L;
    // Floor tile grid — perspective lines converging toward image center
    const cx = W / 2;
    const vanishingY = L.wallTopY - 40;
    ctx.strokeStyle = "rgba(140,180,210,0.18)";
    ctx.lineWidth = 1;
    // Vertical converging lines
    const lanes = 8;
    for (let i = -lanes; i <= lanes; i++) {
      const t = i / lanes;
      const xBottom = cx + t * W * 1.2;
      ctx.beginPath();
      ctx.moveTo(xBottom, H);
      ctx.lineTo(cx + t * W * 0.15, vanishingY);
      ctx.stroke();
    }
    // Horizontal floor bands (closer rows farther apart)
    for (let i = 1; i <= 8; i++) {
      const t = 1 - 1 / (1 + i * 0.7);
      const y = vanishingY + (H - vanishingY) * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawPillars(L, state) {
    const { W, H } = L;
    // Two pillars flanking the wall
    const pillarBaseY = L.wallTopY - 12;
    const pillarBottomY = H * 0.88;
    const xs = [L.wallLeftX - W * 0.10, L.wallRightX + W * 0.10];
    for (const xc of xs) {
      const w = Math.max(28, W * 0.04);
      ctx.fillStyle = "#3a5778";
      ctx.fillRect(xc - w / 2, pillarBaseY - 30, w, pillarBottomY - pillarBaseY + 30);
      ctx.fillStyle = "#2a4060";
      ctx.fillRect(xc - w / 2, pillarBaseY - 30, w * 0.30, pillarBottomY - pillarBaseY + 30);
      ctx.strokeStyle = "#0c1a2a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xc - w / 2, pillarBaseY - 30, w, pillarBottomY - pillarBaseY + 30);
      // Top cap
      ctx.fillStyle = "#4a6790";
      ctx.fillRect(xc - w / 2 - 4, pillarBaseY - 38, w + 8, 10);
      ctx.strokeRect(xc - w / 2 - 4, pillarBaseY - 38, w + 8, 10);
    }
  }

  // ── Wall ──────────────────────────────────────────────────────────────

  function drawWall(L, wallData, state) {
    const { cellW, cellH, wallLeftX, wallTopY, W } = L;
    const coreCols = 12, coreRows = 12;
    const sideColsNeeded = Math.ceil((wallLeftX / cellW)) + 2;

    for (let r = 0; r < coreRows; r++) {
      const offset = (r % 2 === 0) ? 0 : cellW * 0.5;
      for (let c = -sideColsNeeded; c < coreCols + sideColsNeeded; c++) {
        const x = wallLeftX + c * cellW + offset;
        const y = wallTopY + r * cellH;
        if (x + cellW < -2 || x > W + 2) continue;
        const isDecorative = c < 0 || c >= coreCols;
        const isHole = !isDecorative && wallData[r * coreCols + c] === 1;
        if (isHole) {
          drawHole(x, y, cellW, cellH, c, r, state);
        } else {
          drawBrick(x, y, cellW, cellH, c, r, isDecorative);
        }
      }
    }
  }

  function drawBrick(x, y, w, h, col, row, decorative) {
    const seed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const jitter = ((seed % 17) - 8);
    const baseL = decorative ? 32 : 42;
    const L = Math.max(20, Math.min(62, baseL + jitter * 0.6));
    const H = 14 + ((seed >>> 4) % 8);
    const S = 26 + ((seed >>> 8) % 14);
    ctx.fillStyle = `hsl(${H},${S}%,${L}%)`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `hsla(${H},${S}%,${Math.min(80, L + 14)}%,0.35)`;
    ctx.fillRect(x, y, w, Math.max(1, h * 0.14));
    ctx.fillStyle = `hsla(${H},${S}%,${Math.max(8, L - 18)}%,0.45)`;
    ctx.fillRect(x, y + h - Math.max(1, h * 0.14), w, Math.max(1, h * 0.14));
    ctx.fillStyle = "rgba(220,210,200,0.18)";
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y, 1, h);
  }

  function drawHole(x, y, w, h, col, row, state) {
    if (state.isShooterView) {
      ctx.fillStyle = "#06080a";
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.fillStyle = "#1c2a3a";
      ctx.fillRect(x, y, w, h);
      const opp = state.players[state.shooterIdx];
      const cells = bodyCellsAt(opp.anchorCol, opp.posture, opp.action, opp.actionProgress);
      const match = cells.find((p) => p.col === col && p.row === row);
      if (match) {
        ctx.fillStyle = PART_FILLS[match.part];
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      }
    }
    ctx.strokeStyle = "rgba(60,40,30,0.85)";
    ctx.lineWidth = 1.5;
    const seed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const offsets = [
      [(seed % 5) - 2, ((seed >>> 4) % 5) - 2],
      [((seed >>> 8) % 5) - 2, ((seed >>> 12) % 5) - 2],
      [((seed >>> 16) % 5) - 2, ((seed >>> 20) % 5) - 2],
      [((seed >>> 24) % 5) - 2, ((seed >>> 2) % 5) - 2],
    ];
    ctx.beginPath();
    ctx.moveTo(x + offsets[0][0], y + offsets[0][1]);
    ctx.lineTo(x + w + offsets[1][0], y + offsets[1][1]);
    ctx.lineTo(x + w + offsets[2][0], y + h + offsets[2][1]);
    ctx.lineTo(x + offsets[3][0], y + h + offsets[3][1]);
    ctx.closePath();
    ctx.stroke();
  }

  // ── Characters ────────────────────────────────────────────────────────

  function drawCharacterAt(cx, baseY, scale, posture, action, actionProgress, tint) {
    const shift = actionShift(action, actionProgress);
    ctx.save();
    ctx.translate(cx + shift.pixelDx, baseY + shift.pixelDy);

    if (posture === "prone") {
      // Lying flat — a pill-shaped body
      ctx.fillStyle = tint.body;
      ctx.strokeStyle = tint.outline;
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.ellipse(0, -10 * scale, 42 * scale, 13 * scale, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Head bump
      ctx.fillStyle = tint.face;
      ctx.beginPath();
      ctx.arc(-32 * scale, -12 * scale, 13 * scale, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Eyes
      ctx.fillStyle = tint.eye;
      ctx.beginPath();
      ctx.arc(-37 * scale, -14 * scale, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-27 * scale, -14 * scale, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    let bodyW, bodyH, headR, gap;
    if (posture === "crouch") {
      bodyW = 26 * scale; bodyH = 28 * scale; headR = 18 * scale; gap = 6 * scale;
    } else {
      bodyW = 24 * scale; bodyH = 42 * scale; headR = 20 * scale; gap = 8 * scale;
    }

    // Legs (squat ovals at the bottom)
    ctx.fillStyle = tint.outline;
    ctx.beginPath();
    ctx.ellipse(-bodyW * 0.4, -5 * scale, 6 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(bodyW * 0.4, -5 * scale, 6 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = tint.body;
    ctx.strokeStyle = tint.outline;
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.ellipse(0, -bodyH / 2 - 8 * scale, bodyW, bodyH / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Arms (two short ovals on the sides)
    ctx.fillStyle = tint.body;
    ctx.beginPath();
    ctx.ellipse(-bodyW * 0.95, -bodyH / 2 - 4 * scale, 5 * scale, 14 * scale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(bodyW * 0.95, -bodyH / 2 - 4 * scale, 5 * scale, 14 * scale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Head (round, sits on body)
    const headY = -bodyH - gap - headR;
    ctx.fillStyle = tint.face;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Eyes
    ctx.fillStyle = tint.eye;
    ctx.beginPath();
    ctx.arc(-headR * 0.35, headY - 2 * scale, 2.6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headR * 0.35, headY - 2 * scale, 2.6 * scale, 0, Math.PI * 2);
    ctx.fill();
    // Smirk
    ctx.strokeStyle = tint.eye;
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.arc(0, headY + 4 * scale, 4 * scale, 0, Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  function drawSelfCharacter(L, state) {
    const { W, H } = L;
    const me = state.players[state.viewerIdx];
    const isShooter = state.isShooterView;
    const cx = W / 2;
    const baseY = H * 0.94;
    const scale = isShooter ? 1.5 : 1.7;
    const tint = isShooter ? CHARACTER.shooter : CHARACTER.hider;
    drawCharacterAt(cx, baseY, scale, me.posture, me.action, me.actionProgress, tint);

    // Gun for shooter (over right shoulder)
    if (isShooter && me.posture !== "prone") {
      ctx.save();
      ctx.translate(cx + 22 * scale, baseY - 42 * scale);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(0, 0, 30 * scale, 6 * scale);
      ctx.fillStyle = "#222";
      ctx.fillRect(26 * scale, -2 * scale, 4 * scale, 10 * scale);
      ctx.restore();
    }
  }

  function drawDistantShooter(L, shooter, state) {
    const cx = L.W / 2 + (shooter.aim.col - 6) * 4;
    const baseY = L.wallTopY - 8;
    const scale = 0.55;
    drawCharacterAt(cx, baseY, scale, "stand", null, 0, CHARACTER.shooter);
    // Tiny gun in the distance
    ctx.fillStyle = "#222";
    ctx.fillRect(cx + 10 * scale, baseY - 32 * scale, 14 * scale, 3 * scale);
  }

  // ── Laser ─────────────────────────────────────────────────────────────

  function drawLaser(L, shooter, state) {
    const { cellW, cellH, wallLeftX, wallTopY } = L;
    const aimX = wallLeftX + (shooter.aim.col + 0.5) * cellW;
    const aimY = wallTopY + (shooter.aim.row + 0.5) * cellH;

    if (state.phase === "battle") {
      const muzzle = state.isShooterView
        ? { x: L.W / 2 + 40, y: L.H * 0.78 }
        : muzzleFromDistantShooter(L, state);
      ctx.strokeStyle = "rgba(255,40,40,0.4)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,220,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      ctx.lineCap = "butt";
    }

    // Bright dot on the wall (visible to both sides)
    const halo = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, Math.max(cellW, cellH) * 1.3);
    halo.addColorStop(0, "rgba(255,40,40,0.85)");
    halo.addColorStop(0.5, "rgba(255,40,40,0.35)");
    halo.addColorStop(1, "rgba(255,40,40,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(aimX - cellW * 2, aimY - cellH * 2, cellW * 4, cellH * 4);
    ctx.fillStyle = "#ff1f1f";
    ctx.beginPath();
    ctx.arc(aimX, aimY, Math.min(cellW, cellH) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function muzzleFromDistantShooter(L, state) {
    const shooter = state.players[state.shooterIdx];
    const cx = L.W / 2 + (shooter.aim.col - 6) * 4;
    const baseY = L.wallTopY - 8;
    return { x: cx + 16 * 0.55, y: baseY - 28 };
  }

  // ── Sniper scope vignette (shooter only) ──────────────────────────────

  function drawScopeVignette(W, H, cx, cy) {
    const innerR = Math.min(W, H) * 0.28;
    const outerR = Math.max(W, H);
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.4, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.9, "rgba(0,0,0,0.92)");
    grad.addColorStop(1, "rgba(0,0,0,0.96)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Scope ring outline
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawCrosshair(cx, cy, radius) {
    ctx.strokeStyle = "rgba(255,30,30,0.85)";
    ctx.lineWidth = 1.5;
    const gap = 8;
    const arm = radius * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.fillStyle = "#ff3030";
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    draw,
    get lastState() { return lastState; },
  };
}
