// Mirror of server/stickman.js — keep these in sync.
const POSTURE_BLOCKS = {
  stand: [
    { rows: [1, 3], cols: [-1, 1], part: "head" },
    { rows: [4, 12], cols: [-1, 1], part: "torso" },
    { rows: [13, 22], cols: [-1, 1], part: "limb" },
  ],
  crouch: [
    { rows: [7, 9], cols: [-1, 1], part: "head" },
    { rows: [10, 15], cols: [-1, 1], part: "torso" },
    { rows: [16, 22], cols: [-1, 1], part: "limb" },
  ],
  prone: [
    { rows: [20, 21], cols: [-4, -3], part: "head" },
    { rows: [20, 21], cols: [-2, 2], part: "torso" },
    { rows: [20, 21], cols: [3, 4], part: "limb" },
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

const PART_COLORS = {
  head: "#ff8a80",
  torso: "#ffa726",
  limb: "#fdd835",
};

const ROLE_TINT = {
  shooter: { stroke: "#ff5252", fill: "#7a1f1f" },
  hider:   { stroke: "#4fc3f7", fill: "#1e4d63" },
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

  function wallRectFor(state) {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const isShooter = state.isShooterView;
    const aspect = state.wallCols / state.wallRows; // ~0.5
    if (isShooter) {
      // Wall sits roughly centered, 55–65% of canvas height
      const maxH = H * 0.62;
      const maxW = W * 0.66;
      let wallH = maxH;
      let wallW = wallH * aspect;
      if (wallW > maxW) { wallW = maxW; wallH = wallW / aspect; }
      const x = (W - wallW) / 2;
      const y = (H - wallH) / 2 - H * 0.04;
      return { x, y, w: wallW, h: wallH };
    } else {
      // Hider — wall fills most of the screen
      const wallH = H * 0.9;
      let wallW = wallH * aspect;
      if (wallW > W * 0.92) { wallW = W * 0.92; }
      const finalH = wallW / aspect;
      const x = (W - wallW) / 2;
      const y = (H - finalH) * 0.45;
      return { x, y, w: wallW, h: finalH };
    }
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
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // Ground / sky hints (helps depth perception)
    drawScenery(state, W, H);

    const wallRect = wallRectFor(state);
    const cols = state.wallCols, rows = state.wallRows;
    const cw = wallRect.w / cols, ch = wallRect.h / rows;
    const wall = decodeWall(state.wall);

    const oppIdx = 1 - state.viewerIdx;
    const opp = state.players[oppIdx];
    const oppBodyCells = bodyCellsAt(opp.anchorCol, opp.posture);
    const oppCellMap = new Map();
    for (const c of oppBodyCells) oppCellMap.set(c.col + "," + c.row, c.part);

    // Wall cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = wallRect.x + c * cw;
        const y = wallRect.y + r * ch;
        const isHole = wall[r * cols + c] === 1;
        if (isHole) {
          // Holes show the far side
          const part = oppCellMap.get(c + "," + r);
          if (part) {
            ctx.fillStyle = PART_COLORS[part];
            ctx.fillRect(x, y, cw, ch);
          } else {
            ctx.fillStyle = "#000";
            ctx.fillRect(x, y, cw, ch);
          }
          // hole rim
          ctx.strokeStyle = "rgba(255,180,80,0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        } else {
          // intact brick
          const shade = ((r * 31 + c * 17) % 13) - 6;
          ctx.fillStyle = `rgb(${94 + shade}, ${76 + shade}, ${62 + shade})`;
          ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        }
      }
    }

    // Wall outer frame
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 2;
    ctx.strokeRect(wallRect.x - 1, wallRect.y - 1, wallRect.w + 2, wallRect.h + 2);

    // Laser: aim of the shooter is visible to both sides as a glowing dot;
    // shooter also sees a beam from their gun-muzzle.
    if (state.phase === "battle" || state.phase === "prep") {
      const shooter = state.players[state.shooterIdx];
      const aimX = wallRect.x + (shooter.aim.col + 0.5) * cw;
      const aimY = wallRect.y + (shooter.aim.row + 0.5) * ch;
      // Glowing spot
      const g = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, Math.max(cw, ch) * 0.8);
      g.addColorStop(0, "rgba(255,40,40,0.95)");
      g.addColorStop(0.4, "rgba(255,40,40,0.5)");
      g.addColorStop(1, "rgba(255,40,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(aimX - cw * 1.5, aimY - ch * 1.5, cw * 3, ch * 3);
      ctx.fillStyle = "#ff2727";
      ctx.beginPath();
      ctx.arc(aimX, aimY, Math.min(cw, ch) * 0.25, 0, Math.PI * 2);
      ctx.fill();

      if (state.isShooterView && state.phase === "battle") {
        // Beam from your stickman's muzzle to the aim point.
        const muzzle = selfStickmanMuzzle(state, W, H);
        ctx.strokeStyle = "rgba(255,40,40,0.55)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(muzzle.x, muzzle.y);
        ctx.lineTo(aimX, aimY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Self stickman (back view) at the bottom
    drawSelfStickman(state, W, H);

    // Prep overlay for shooter (can't see hider preparing)
    if (state.phase === "prep" && state.isShooterView) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 24px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("对方准备中…", W / 2, H / 2 - 20);
      if (state.timer != null) {
        ctx.font = "bold 48px ui-monospace, monospace";
        ctx.fillStyle = "#ffb300";
        ctx.fillText(`${Math.ceil(state.timer)}s`, W / 2, H / 2 + 30);
      }
    }
  }

  function selfStickmanMuzzle(state, W, H) {
    // Muzzle approximately at chest height of the bottom-center stickman
    return { x: W / 2, y: H * 0.82 };
  }

  function drawSelfStickman(state, W, H) {
    const isShooter = state.isShooterView;
    const me = state.players[state.viewerIdx];
    const tint = isShooter ? ROLE_TINT.shooter : ROLE_TINT.hider;
    const cx = W / 2;
    const baseY = H * (isShooter ? 0.95 : 0.93);
    const scale = isShooter ? 1.0 : 1.15;
    // Back view: head + shoulders + line for body
    ctx.fillStyle = tint.fill;
    ctx.strokeStyle = tint.stroke;
    ctx.lineWidth = 3 * scale;
    // body
    const bodyH = 80 * scale;
    const headR = 16 * scale;
    let shoulderY;
    if (me.posture === "crouch") {
      shoulderY = baseY - bodyH * 0.55;
    } else if (me.posture === "prone") {
      shoulderY = baseY - 10;
      // prone — draw as horizontal silhouette
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 8 * scale, 60 * scale, 14 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    } else {
      shoulderY = baseY - bodyH;
    }
    // legs
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx - 12 * scale, baseY - bodyH * 0.4);
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx + 12 * scale, baseY - bodyH * 0.4);
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
    // gun (shooter only)
    if (isShooter) {
      ctx.fillStyle = "#444";
      ctx.fillRect(cx + 14 * scale, shoulderY + 4 * scale, 26 * scale, 6 * scale);
      ctx.fillStyle = "#222";
      ctx.fillRect(cx + 36 * scale, shoulderY + 2 * scale, 4 * scale, 10 * scale);
    }
  }

  function drawScenery(state, W, H) {
    // soft floor
    const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
    grad.addColorStop(0, "rgba(20,20,20,0)");
    grad.addColorStop(1, "rgba(40,30,30,0.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);
    // distant floor line
    ctx.strokeStyle = "rgba(100,60,60,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H * (state.isShooterView ? 0.85 : 0.78));
    ctx.lineTo(W, H * (state.isShooterView ? 0.85 : 0.78));
    ctx.stroke();
  }

  function aimFromScreen(state, sx, sy) {
    const wallRect = wallRectFor(state);
    const cw = wallRect.w / state.wallCols;
    const ch = wallRect.h / state.wallRows;
    const col = (sx - wallRect.x) / cw - 0.5;
    const row = (sy - wallRect.y) / ch - 0.5;
    return { aim_col: col, aim_row: row };
  }

  return {
    draw,
    aimFromScreen,
    wallRectFor,
    get lastState() { return lastState; },
  };
}
