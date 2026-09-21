// ─────────────────────────────────────────────────────────────────────────────
// lib/game/renderer.ts  –  All canvas-2D drawing code
// ─────────────────────────────────────────────────────────────────────────────

import {
  CANVAS_W, CANVAS_H, HORIZON_Y, CENTER_X, FOCAL, CAMERA_HEIGHT,
  FAR_Z, NEAR_Z, PLAYER_Z, PLAYER_SCREEN_Y, PLAYER_WORLD_HEIGHT,
  LANE_WORLD_X, TRACK_HALF_W,
  WALL_HEIGHT, LOW_WALL_HEIGHT, HIGH_BAR_BOTTOM, HIGH_BAR_THICKNESS,
  JUMP_HEIGHT, C,
} from '../constants';
import { project, screenYToRelZ, lerp } from '../utils';
import type { GameState, Obstacle, CoinItem } from '../../types/game';

// ── Canvas scaling helpers ────────────────────────────────────────────────────

/** Scale factor from logical (480×800) to actual canvas pixels */
function scaleOf(canvas: HTMLCanvasElement) {
  return Math.min(canvas.width / CANVAS_W, canvas.height / CANVAS_H);
}

/** Set up the canvas 2D context to draw at logical resolution via CSS-transform scale */
export function setupContext(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const s = scaleOf(canvas);
  const offX = (canvas.width  - CANVAS_W * s) / 2;
  const offY = (canvas.height - CANVAS_H * s) / 2;
  ctx.setTransform(s, 0, 0, s, offX, offY);
}

// ── Master render entry-point ─────────────────────────────────────────────────

export function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: GameState
): void {
  setupContext(ctx, canvas);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawSky(ctx, state);
  drawTrack(ctx, state);
  drawObstacles(ctx, state);
  drawCoins(ctx, state);
  drawPlayer(ctx, state);
  drawParticles(ctx, state);
  drawSpeedLines(ctx, state);
  drawTurnWarning(ctx, state);
}

// ── Sky / background ──────────────────────────────────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Gradient sky
  const grad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 40);
  grad.addColorStop(0,   C.skyTop);
  grad.addColorStop(0.6, C.skyMid);
  grad.addColorStop(1,   C.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y + 40);

  // Horizon glow strip
  const hGrad = ctx.createLinearGradient(0, HORIZON_Y - 20, 0, HORIZON_Y + 20);
  hGrad.addColorStop(0, 'rgba(100,0,255,0)');
  hGrad.addColorStop(0.5, 'rgba(80,0,255,0.35)');
  hGrad.addColorStop(1, 'rgba(50,0,200,0)');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, HORIZON_Y - 20, CANVAS_W, 40);

  // Stars (static seed based on frame for subtle twinkle)
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const starSeed = Math.floor(state.frameCount / 60);
  for (let i = 0; i < 40; i++) {
    const sx = pseudoRand(i * 7 + starSeed * 13) * CANVAS_W;
    const sy = pseudoRand(i * 13 + 5) * (HORIZON_Y - 20);
    const ss = 0.5 + pseudoRand(i * 3) * 1.5;
    const alpha = 0.4 + pseudoRand(i * 5 + state.frameCount * 0.02) * 0.6;
    ctx.globalAlpha = alpha;
    ctx.fillRect(sx - ss / 2, sy - ss / 2, ss, ss);
  }
  ctx.globalAlpha = 1;
}

function pseudoRand(seed: number): number {
  const s = Math.sin(seed) * 43758.5453;
  return s - Math.floor(s);
}

// ── Track (pseudo-3D strip rendering) ────────────────────────────────────────

function drawTrack(ctx: CanvasRenderingContext2D, state: GameState): void {
  const cameraZ = state.cameraZ;

  // Draw from bottom (near) to top (far) so later iterations overwrite earlier
  // But for correct visual we draw FAR → NEAR (painter's algorithm)
  // We iterate screen-Y from HORIZON_Y to CANVAS_H in small steps
  const STEP = 3;

  for (let sy = HORIZON_Y; sy <= CANVAS_H; sy += STEP) {
    const relZ = screenYToRelZ(sy);
    if (relZ < NEAR_Z || relZ > FAR_Z) continue;

    const absZ = cameraZ + relZ;
    const scale = FOCAL / relZ;

    // Track half-width at this depth
    const hw = TRACK_HALF_W * scale;
    const lx = CENTER_X - hw;
    const rx = CENTER_X + hw;

    // Alternating stripe colour (world-Z based so stripes scroll toward player)
    const stripeIdx = Math.floor(absZ / 220) % 2;
    const alpha = Math.max(0, Math.min(1, (relZ - NEAR_Z) / 200)); // fade near clip
    ctx.globalAlpha = alpha;
    ctx.fillStyle = stripeIdx === 0 ? C.trackDark : C.trackLight;
    ctx.fillRect(lx, sy, rx - lx, STEP + 1);
  }
  ctx.globalAlpha = 1;

  // ── Lane dividers (two neon lines)
  drawLaneDivider(ctx, state, 1); // between lane 0-1
  drawLaneDivider(ctx, state, 2); // between lane 1-2

  // ── Track outer edge lines
  drawTrackEdge(ctx, state, -1); // left edge
  drawTrackEdge(ctx, state, 1);  // right edge

  // ── Side tunnel walls
  drawTunnelWalls(ctx, state);
}

function drawLaneDivider(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  divIndex: 1 | 2
): void {
  // World-X of the divider (between lanes)
  const worldX = LANE_WORLD_X[divIndex - 1] + (LANE_WORLD_X[1] - LANE_WORLD_X[0]) / 2;
  // Actually between lane (divIndex-1) and (divIndex):
  const wx = (LANE_WORLD_X[divIndex - 1] + LANE_WORLD_X[divIndex]) / 2;

  drawPerspectiveLine(ctx, state, wx, C.laneDiv, 1.5, 8);
}

function drawTrackEdge(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  side: -1 | 1 // -1=left, 1=right
): void {
  const wx = TRACK_HALF_W * side;
  drawPerspectiveLine(ctx, state, wx, C.trackEdge, 2, 20);
}

/** Draw a vertical line in perspective (lane divider / edge) */
function drawPerspectiveLine(
  ctx: CanvasRenderingContext2D,
  _state: GameState,
  worldX: number,
  color: string,
  lineWidth: number,
  blur: number
): void {
  // Find screen coords at near and far
  const near = project(NEAR_Z + 60, worldX);
  const far  = project(FAR_Z * 0.7, worldX);
  if (!near || !far) return;

  ctx.save();
  ctx.shadowColor  = color;
  ctx.shadowBlur   = blur;
  ctx.strokeStyle  = color;
  ctx.lineWidth    = lineWidth;
  ctx.beginPath();
  ctx.moveTo(far.x, far.y);
  ctx.lineTo(near.x, near.y);
  ctx.stroke();
  ctx.restore();
}

function drawTunnelWalls(ctx: CanvasRenderingContext2D, _state: GameState): void {
  // Left wall: from horizon-point to bottom-left
  const vanish = { x: CENTER_X, y: HORIZON_Y };
  const bl = project(NEAR_Z + 60, -TRACK_HALF_W);
  const br = project(NEAR_Z + 60, TRACK_HALF_W);
  if (!bl || !br) return;

  // Left wall polygon
  ctx.save();
  const lwGrad = ctx.createLinearGradient(0, HORIZON_Y, bl.x, CANVAS_H);
  lwGrad.addColorStop(0, 'rgba(80,0,180,0)');
  lwGrad.addColorStop(1, 'rgba(80,0,180,0.45)');
  ctx.fillStyle = lwGrad;
  ctx.beginPath();
  ctx.moveTo(vanish.x, vanish.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.lineTo(0, CANVAS_H);
  ctx.lineTo(0, HORIZON_Y);
  ctx.closePath();
  ctx.fill();

  // Right wall polygon
  const rwGrad = ctx.createLinearGradient(CANVAS_W, HORIZON_Y, br.x, CANVAS_H);
  rwGrad.addColorStop(0, 'rgba(0,50,180,0)');
  rwGrad.addColorStop(1, 'rgba(0,50,180,0.45)');
  ctx.fillStyle = rwGrad;
  ctx.beginPath();
  ctx.moveTo(vanish.x, vanish.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(CANVAS_W, CANVAS_H);
  ctx.lineTo(CANVAS_W, HORIZON_Y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Obstacles ─────────────────────────────────────────────────────────────────

function drawObstacles(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Sort far → near so closer ones paint on top
  const visible = state.obstacles
    .filter(o => {
      const d = o.worldZ - state.cameraZ;
      return d > NEAR_Z && d < FAR_Z;
    })
    .sort((a, b) => b.worldZ - a.worldZ);

  for (const obs of visible) {
    const relZ = obs.worldZ - state.cameraZ;
    drawObstacle(ctx, obs, relZ);
  }
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obs: Obstacle,
  relZ: number
): void {
  const scale = FOCAL / relZ;
  const laneCount = obs.lane === -1 ? 3 : 1;
  const startLane = obs.lane === -1 ? 0 : obs.lane;

  for (let li = 0; li < laneCount; li++) {
    const lane = startLane + li;
    const wx = LANE_WORLD_X[lane as 0 | 1 | 2];
    const cx = CENTER_X + wx * scale;
    const lw = (TRACK_HALF_W * 2 / 3) * scale; // lane width at this depth

    if (obs.type === 'WALL') {
      const h = WALL_HEIGHT * scale;
      const w = lw * 0.88;
      const bottom = HORIZON_Y + CAMERA_HEIGHT * scale;
      drawGlowRect(ctx, cx - w / 2, bottom - h, w, h, C.wallFill, C.wallGlow, 18 * scale);
    } else if (obs.type === 'LOW_WALL') {
      const h = LOW_WALL_HEIGHT * scale;
      const w = lw * 0.88;
      const bottom = HORIZON_Y + CAMERA_HEIGHT * scale;
      drawGlowRect(ctx, cx - w / 2, bottom - h, w, h, C.lowWallFill, C.lowWallGlow, 14 * scale);
      // Arrow above it pointing up (hint: jump)
      drawArrowHint(ctx, cx, bottom - h - 8 * scale, '↑', C.lowWallGlow, scale);
    } else if (obs.type === 'HIGH_BAR') {
      const barBottom = HORIZON_Y + (CAMERA_HEIGHT - HIGH_BAR_BOTTOM) * scale;
      const barH = HIGH_BAR_THICKNESS * scale;
      const w = lw * 0.88;
      drawGlowRect(ctx, cx - w / 2, barBottom - barH, w, barH, C.highBarFill, C.highBarGlow, 12 * scale);
      // Arrow pointing down (hint: slide)
      drawArrowHint(ctx, cx, barBottom + 6 * scale, '↓', C.highBarGlow, scale);
      // Support pillars
      const groundY = HORIZON_Y + CAMERA_HEIGHT * scale;
      ctx.save();
      ctx.strokeStyle = C.highBarFill;
      ctx.lineWidth = 3 * scale;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.3, barBottom); ctx.lineTo(cx - w * 0.3, groundY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.3, barBottom); ctx.lineTo(cx + w * 0.3, groundY); ctx.stroke();
      ctx.restore();
    } else if (obs.type === 'TURN_LEFT' || obs.type === 'TURN_RIGHT') {
      // Draw a large glowing arrow on the track
      const dir = obs.type === 'TURN_LEFT' ? -1 : 1;
      const gy = HORIZON_Y + CAMERA_HEIGHT * scale;
      drawTurnGate(ctx, cx, gy, dir, scale);
    }
  }
}

function drawGlowRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  fill: string, glow: string, blur: number
): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur  = Math.max(2, blur);
  ctx.fillStyle   = fill;
  ctx.fillRect(x, y, w, h);
  // Bright top edge
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x, y, w, Math.max(1, h * 0.06));
  ctx.restore();
}

function drawArrowHint(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, arrow: string,
  color: string, scale: number
): void {
  const size = Math.max(8, 14 * scale);
  ctx.save();
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(arrow, cx, cy);
  ctx.restore();
}

function drawTurnGate(
  ctx: CanvasRenderingContext2D,
  cx: number, _gy: number, dir: number, scale: number
): void {
  ctx.save();
  ctx.shadowColor = C.turnGlow;
  ctx.shadowBlur = 20 * scale;
  ctx.strokeStyle = C.turnArrow;
  ctx.lineWidth = 4 * scale;
  const sz = 30 * scale;
  const ax = cx + dir * sz * 0.5;
  const ay = _gy - sz;
  ctx.beginPath();
  ctx.moveTo(ax - dir * sz, ay);
  ctx.lineTo(ax, ay - sz * 0.5);
  ctx.lineTo(ax, ay - sz * 0.2);
  ctx.lineTo(ax + dir * sz * 0.6, ay - sz * 0.2);
  ctx.lineTo(ax + dir * sz * 0.6, ay + sz * 0.2);
  ctx.lineTo(ax, ay + sz * 0.2);
  ctx.lineTo(ax, ay + sz * 0.5);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,255,100,0.2)';
  ctx.fill();
  ctx.restore();
}

// ── Coins ──────────────────────────────────────────────────────────────────────

function drawCoins(ctx: CanvasRenderingContext2D, state: GameState): void {
  const visible = state.coinItems
    .filter(c => {
      if (c.collected) return false;
      const d = c.worldZ - state.cameraZ;
      return d > NEAR_Z && d < FAR_Z;
    })
    .sort((a, b) => b.worldZ - a.worldZ);

  for (const coin of visible) {
    const relZ = coin.worldZ - state.cameraZ;
    const scale = FOCAL / relZ;
    const wx = LANE_WORLD_X[coin.lane];
    const cx = CENTER_X + wx * scale;
    const cy = HORIZON_Y + (CAMERA_HEIGHT - 40) * scale; // float slightly above ground
    const r  = Math.max(3, 12 * scale);

    ctx.save();
    ctx.shadowColor = C.coinGlow;
    ctx.shadowBlur  = 14 * scale;
    // Rotating coin (flat → circle)
    const spin = (state.frameCount * 0.08 + coin.id) % (Math.PI * 2);
    const xScale = Math.abs(Math.cos(spin));
    ctx.fillStyle = xScale < 0.2 ? 'rgba(255,230,0,0.4)' : C.coin;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * xScale + 1, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.2, cy - r * 0.3, r * 0.25 * xScale, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Player ────────────────────────────────────────────────────────────────────

function drawPlayer(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player;

  // Calculate screen-X: interpolate between lane positions
  const fromX = laneScreenX(p.lane);
  const toX   = laneScreenX(p.targetLane);
  const t     = smoothstep(p.laneT);
  const px    = lerp(fromX, toX, t);

  // Calculate screen-Y (feet position + jump offset)
  const jumpScreenOffset = -(p.worldY / CAMERA_HEIGHT) * (PLAYER_SCREEN_Y - HORIZON_Y);
  const py = PLAYER_SCREEN_Y + jumpScreenOffset;

  const bodyH = 80;
  const bodyW = 28;
  const headR = 14;

  ctx.save();
  ctx.shadowColor = C.playerGlow;
  ctx.shadowBlur  = 20;

  if (p.action === 'sliding') {
    // Flat body
    ctx.fillStyle = C.playerBody;
    ctx.fillRect(px - bodyH * 0.4, py - bodyW * 0.5, bodyH * 0.8, bodyW * 0.5);
    // Head to the side
    ctx.beginPath();
    ctx.arc(px + bodyH * 0.3, py - bodyW * 0.3, headR * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = C.playerAccent;
    ctx.fill();
  } else {
    // Upright body
    const legOff = Math.sin(p.animFrame * Math.PI / 2) * 12;

    // Legs
    ctx.strokeStyle = C.playerAccent;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py - 22);
    ctx.lineTo(px - 8, py + legOff);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, py - 22);
    ctx.lineTo(px + 8, py - legOff);
    ctx.stroke();

    // Arms
    ctx.strokeStyle = C.playerBody;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px, py - 44);
    ctx.lineTo(px - 14, py - 30 - legOff * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, py - 44);
    ctx.lineTo(px + 14, py - 30 + legOff * 0.5);
    ctx.stroke();

    // Torso
    ctx.fillStyle = C.playerBody;
    ctx.fillRect(px - bodyW / 2, py - bodyH + 10, bodyW, bodyH * 0.55);

    // Head
    ctx.fillStyle = C.playerAccent;
    ctx.beginPath();
    ctx.arc(px, py - bodyH + 5, headR, 0, Math.PI * 2);
    ctx.fill();

    // Visor
    ctx.fillStyle = 'rgba(0,220,255,0.8)';
    ctx.fillRect(px - headR * 0.7, py - bodyH + 1, headR * 1.4, headR * 0.5);
  }

  // Trail glow under feet
  const trailGrad = ctx.createLinearGradient(px - 20, py, px + 20, py + 15);
  trailGrad.addColorStop(0, 'rgba(0,200,255,0)');
  trailGrad.addColorStop(0.5, 'rgba(0,200,255,0.4)');
  trailGrad.addColorStop(1, 'rgba(0,200,255,0)');
  ctx.fillStyle = trailGrad;
  ctx.fillRect(px - 20, py, 40, 15);

  ctx.restore();
}

function laneScreenX(lane: number): number {
  return CENTER_X + LANE_WORLD_X[lane as 0 | 1 | 2] * FOCAL / PLAYER_Z;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ── Particles ──────────────────────────────────────────────────────────────────

function drawParticles(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const p of state.particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// ── Speed lines ───────────────────────────────────────────────────────────────

function drawSpeedLines(ctx: CanvasRenderingContext2D, state: GameState): void {
  const intensity = (state.speed - 10) / 20; // only at higher speeds
  if (intensity <= 0) return;

  ctx.save();
  ctx.globalAlpha = intensity * 0.5;
  ctx.strokeStyle = C.speedLine;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < 12; i++) {
    const seed = i * 137.5;
    const sx = pseudoRand(seed + state.frameCount * 0.3 % 100) * CANVAS_W;
    const sy = HORIZON_Y + pseudoRand(seed + 50) * (CANVAS_H - HORIZON_Y);
    const len = 20 + pseudoRand(seed + 100) * 60;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy + len);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Turn warning HUD overlay ──────────────────────────────────────────────────

function drawTurnWarning(ctx: CanvasRenderingContext2D, state: GameState): void {
  const tw = state.turnWarning;
  if (!tw || tw.completed) return;

  const depth = tw.worldZ - state.cameraZ;
  if (depth > 700 || depth < 0) return; // only show when close

  const progress = 1 - depth / 700; // 0=far, 1=at player
  const pulse = 0.6 + 0.4 * Math.sin(state.frameCount * 0.25);

  const arrowDir = tw.direction === 'left' ? '← TURN LEFT' : 'TURN RIGHT →';
  const urgency = tw.timer / tw.maxTimer;

  ctx.save();
  ctx.globalAlpha = Math.min(1, progress * 1.5) * pulse;
  ctx.font = `bold ${24 + progress * 10}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.shadowColor = C.turnGlow;
  ctx.shadowBlur = 20;
  ctx.fillStyle = urgency > 0.4 ? C.turnArrow : '#ff4444';
  ctx.fillText(arrowDir, CENTER_X, HORIZON_Y - 30 + progress * 20);

  // Timer bar
  const bw = 200 * urgency;
  ctx.fillStyle = urgency > 0.4 ? C.turnArrow : '#ff4444';
  ctx.shadowBlur = 8;
  ctx.fillRect(CENTER_X - bw / 2, HORIZON_Y - 8, bw, 5);
  ctx.restore();
}
