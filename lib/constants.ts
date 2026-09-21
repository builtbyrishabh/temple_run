// ─────────────────────────────────────────────────────────────────────────────
// lib/constants.ts  –  All tunable game constants in one place
// ─────────────────────────────────────────────────────────────────────────────

import type { Difficulty, SolidObstacleType } from '../types/game';

// ── Canvas logical resolution ──────────────────────────────────────────────
export const CANVAS_W = 480;
export const CANVAS_H = 800;

// ── 3-D Perspective projection ─────────────────────────────────────────────
//
//  Screen-Y formula for a world point at depth relZ above ground (worldY):
//    screenY = HORIZON_Y + (CAMERA_HEIGHT - worldY) * FOCAL / relZ
//
//  Derived constants so that the ground appears at PLAYER_SCREEN_Y
//  when an object is exactly PLAYER_Z world-units in front of camera:
//    CAMERA_HEIGHT * FOCAL / PLAYER_Z  =  PLAYER_SCREEN_Y - HORIZON_Y
//    200 × 444 / 200  =  444   →  256 + 444 = 700 ✓
//
export const HORIZON_Y = 256;         // screen-Y of the vanishing point
export const CENTER_X = 240;         // screen-X centre
export const FOCAL = 444;            // focal length  (world units)
export const CAMERA_HEIGHT = 200;    // camera height above the ground plane

export const PLAYER_Z = 200;         // depth at which collision is checked
export const PLAYER_SCREEN_Y = 700;  // screen-Y of the player's feet

// ── Lane layout ────────────────────────────────────────────────────────────
//  At depth PLAYER_Z the three lane centres project to screen-X:
//    240 ± 72 × 444/200  =  240 ± 160  →  [80, 240, 400]
export const LANE_WORLD_X: readonly [number, number, number] = [-72, 0, 72];
export const TRACK_HALF_W = 160;     // world-X of track outer edges

// ── Render depths ──────────────────────────────────────────────────────────
// A corridor that stops has to stop somewhere the eye cannot follow. These are
// deliberately far: with obstacles built only 2000 ahead the haze that hid them
// appearing had to sit at 2250 too, and a wall of haze a second and a half out
// reads as the end of the world rather than as distance.
export const FAR_Z   = 5800;          // far-clip (render nothing beyond this)
export const NEAR_Z  = 80;            // near-clip (stop drawing below this)
export const SPAWN_Z = 5600;          // how far ahead new obstacles are placed

// ── Gameplay ────────────────────────────────────────────────────────────────
export const INITIAL_SPEED   = 8;      // world-Z units per frame  @ 60 fps
export const MAX_SPEED        = 30;
/**
 * Added to `speed` every frame, per difficulty — how long a run takes to reach
 * MAX_SPEED, and with it the tightest obstacle spacing (see MIN_GAP_SECONDS).
 * Since spacing is held in seconds, the ramp is the difficulty *clock*: easy
 * takes ~3½ minutes to arrive at its endgame, hard a little over one.
 */
export const SPEED_INCREASE: Record<Difficulty, number> = {
  easy:   0.0017,
  medium: 0.0028,
  hard:   0.0050,
};

// ── Player physics (world-unit heights) ────────────────────────────────────
export const PLAYER_WORLD_HEIGHT = 160; // standing height
export const JUMP_HEIGHT         = 130; // peak height during jump
export const JUMP_FRAMES         = 34;
export const SLIDE_HEIGHT        = 60;  // effective hitbox height while sliding
export const SLIDE_FRAMES        = 30;
export const LANE_CHANGE_FRAMES  = 12;

// ── Obstacle world heights ──────────────────────────────────────────────────
export const WALL_HEIGHT       = 220;   // full wall – must change lane
export const LOW_WALL_HEIGHT   = 95;    // jump over  (< JUMP_HEIGHT)
export const HIGH_BAR_BOTTOM   = 95;    // slide under (> SLIDE_HEIGHT, < PLAYER_WORLD_HEIGHT)
export const HIGH_BAR_THICKNESS = 40;

// ── Collision footprints ───────────────────────────────────────────────────
//
//  How much corridor each obstacle occupies, front to back. This is the one
//  place the answer lives: the renderer scales its models to these depths, the
//  engine tests contact against them, and the AI's timing layer derives its
//  jump and slide leads from them — so what you see, what collides, and what
//  Jev is told can no longer disagree. They did: contact used a single 220-unit
//  window for everything while a train was drawn 430 long, so you could clip
//  the nose of a train and run on.
export const OBSTACLE_DEPTH: Record<SolidObstacleType, number> = {
  WALL:     430,   // a train, and it is as long as it looks
  LOW_WALL:  90,
  HIGH_BAR:  70,
};

/** Corridor the runner itself occupies, front to back. */
export const PLAYER_DEPTH = 60;

/**
 * Shaved off both ends of every overlap. Contact is resolved between boxes and
 * boxes meet a frame before the models visibly touch, so this is the grace that
 * lets a near miss read as a near miss rather than as an unfair hit.
 */
export const COLLISION_MARGIN = 18;

/** Depth at which an obstacle of `type` starts being able to touch the runner. */
export function collisionEntryZ(type: SolidObstacleType): number {
  return PLAYER_Z + collisionHalfDepth(type);
}

/** Depth past which it is behind the runner and can no longer touch it. */
export function collisionExitZ(type: SolidObstacleType): number {
  return PLAYER_Z - collisionHalfDepth(type);
}

/** Half the depth over which an obstacle of `type` and the runner overlap. */
export function collisionHalfDepth(type: SolidObstacleType): number {
  return (OBSTACLE_DEPTH[type] + PLAYER_DEPTH) / 2 - COLLISION_MARGIN;
}

// ── Obstacle spacing ───────────────────────────────────────────────────────
//
//  Spacing is a *time*, not a distance, and the engine multiplies it by the
//  current speed when it schedules the next wave. A fixed Z-gap looks fair on
//  paper and is not: everything the runner can do costs a fixed number of
//  frames (a jump is 34, a slide 30, a stumble 40), so as speed ramps 8 → 30 a
//  constant distance shrinks to a fraction of a single jump and waves arrive
//  that no sequence of inputs can answer. Holding the gap in seconds keeps the
//  number of frames the runner has to react constant all the way to MAX_SPEED.
//
//  Spacing then tightens from OPENING_GAP_SECONDS to MIN_GAP_SECONDS as the
//  speed ramp runs, because that is the only thing left that can make a run get
//  harder: with the gap held in seconds, raw speed no longer costs the runner
//  any reaction time, so without this the corridor would be exactly as hard at
//  two minutes as at five seconds and a good run would never end.
export const OPENING_GAP_SECONDS = 2.2;

//  Both numbers are floored by what one answer costs end to end: the previous
//  wave finishing its crossing of the collision window, plus the decision
//  cadence, plus a round trip, plus the lead a jump needs to straddle the
//  window. That sum is speed-dependent — the first and last terms shrink as the
//  corridor speeds up — so it is ~1.4s at INITIAL_SPEED and ~1.16s at
//  MAX_SPEED. OPENING_GAP_SECONDS clears the first; MIN_GAP_SECONDS, which is
//  only reached once the ramp tops out, sits just above the second. Go below
//  either and waves arrive while the runner is still airborne over the last
//  one, with no answer left to give.
export const MIN_GAP_SECONDS: Record<Difficulty, number> = {
  easy:   1.5,
  medium: 1.35,
  hard:   1.15,
};

/** Extra spacing on top of MIN_GAP_SECONDS, so waves do not arrive on a metronome. */
export const GAP_JITTER_SECONDS = 0.4;

// ── Turn events ────────────────────────────────────────────────────────────
//
//  A gate arms this long before it reaches the runner, and that is exactly how
//  long there is to answer it. Both halves have to be a time: arming used to be
//  a fixed 700-unit depth while the countdown was a fixed frame count, so at
//  speed the gate armed a quarter of a second before it swept past the runner
//  and then went on demanding an answer for another two seconds.
export const TURN_WARNING_SECONDS = 4.5;
export const TURN_WARNING_FRAMES = Math.round(TURN_WARNING_SECONDS * 60);

/** Depth at which a gate arms: close enough that pressing its direction counts. */
export function turnArmsAtDepth(speed: number): number {
  return PLAYER_Z + TURN_WARNING_SECONDS * 60 * speed;
}

/** Seconds between turn gates. In time for the same reason as MIN_GAP_SECONDS:
 *  a gate allows TURN_WARNING_FRAMES to answer, and gates spaced by distance
 *  started overlapping that window well before MAX_SPEED. */
export const TURN_SPACING_SECONDS: Record<Difficulty, number> = {
  easy:   24,
  medium: 21,
  hard:   15,
};

/** Extra spacing on top of TURN_SPACING_SECONDS. */
export const TURN_JITTER_SECONDS = 3;

// ── Coins ─────────────────────────────────────────────────────────────────
export const COIN_VALUE         = 50;
export const COIN_CLUSTER_SIZE  = 6;
export const COIN_SPACING_Z     = 90;   // Z gap between coins in a cluster

// ── Scoring ────────────────────────────────────────────────────────────────
export const SCORE_PER_FRAME = 0.12;    // base score per frame at full speed
export const DIST_SCALE      = 0.008;   // cameraZ → displayed metres

// ── Visual theme colours ────────────────────────────────────────────────────
export const C = {
  // Background / sky
  skyTop:        '#060014',
  skyMid:        '#0d0030',
  skyBottom:     '#18005c',
  horizon:       '#3300ff',
  // Track
  trackDark:     '#120030',
  trackLight:    '#1c0048',
  laneDiv:       '#6600ff',
  laneDivBright: '#aa44ff',
  trackEdge:     '#cc00ff',
  trackEdgeGlow: 'rgba(180,0,255,0.6)',
  // Side tunnel walls
  tunnelLeft:    '#220055',
  tunnelRight:   '#220055',
  // Player
  playerBody:    '#00e5ff',
  playerAccent:  '#0066ff',
  playerGlow:    '#00e5ff',
  // Obstacles
  wallFill:      '#ff1a4a',
  wallGlow:      '#ff0033',
  lowWallFill:   '#ff6600',
  lowWallGlow:   '#ff4400',
  highBarFill:   '#ffaa00',
  highBarGlow:   '#ff7700',
  // Turn
  turnArrow:     '#00ff99',
  turnGlow:      '#00ff66',
  // Coins
  coin:          '#ffe600',
  coinGlow:      '#ffaa00',
  // HUD
  hudText:       '#ffffff',
  hudGlow:       '#00e5ff',
  hudDim:        'rgba(255,255,255,0.55)',
  // Particles
  hitSpark:      '#ff3355',
  coinSpark:     '#ffe600',
  speedLine:     'rgba(0,200,255,0.25)',
} as const;
