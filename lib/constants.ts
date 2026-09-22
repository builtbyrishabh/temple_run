// ─────────────────────────────────────────────────────────────────────────────
// lib/constants.ts  –  All tunable game constants in one place
// ─────────────────────────────────────────────────────────────────────────────

import type { Difficulty, ObstacleType } from '../types/game';

// ── Corridor layout ────────────────────────────────────────────────────────
//
//  World space, and the only space the game thinks in: +Z runs away down the
//  corridor, +Y is up from the ground, X is lateral. The renderer maps this
//  onto a camera; nothing here knows how it is drawn.

/** Depth in front of the camera at which the runner stands and contact resolves. */
export const PLAYER_Z = 200;

/** Lane centres, in world-X. */
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
 * takes ~2 minutes to arrive at its endgame, hard a little over one.
 */
export const SPEED_INCREASE: Record<Difficulty, number> = {
  easy:   0.0030,
  medium: 0.0040,
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
export const OBSTACLE_DEPTH: Record<ObstacleType, number> = {
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
export function collisionEntryZ(type: ObstacleType): number {
  return PLAYER_Z + collisionHalfDepth(type);
}

/** Depth past which it is behind the runner and can no longer touch it. */
export function collisionExitZ(type: ObstacleType): number {
  return PLAYER_Z - collisionHalfDepth(type);
}

/** Half the depth over which an obstacle of `type` and the runner overlap. */
export function collisionHalfDepth(type: ObstacleType): number {
  return (OBSTACLE_DEPTH[type] + PLAYER_DEPTH) / 2 - COLLISION_MARGIN;
}

// ── Obstacle spacing ───────────────────────────────────────────────────────
//
//  Spacing is a *time*, not a distance, and the engine multiplies it by the
//  current speed when it schedules the next wave. A fixed Z-gap looks fair on
//  paper and is not: everything the runner can do costs a fixed number of
//  frames (a jump is 34, a slide 30), so as speed ramps 8 → 30 a constant
//  distance shrinks to a fraction of a single jump and waves arrive that no
//  sequence of inputs can answer. Holding the gap in seconds keeps the number
//  of frames the runner has to react constant all the way to MAX_SPEED.
//
//  Spacing then tightens from OPENING_GAP_SECONDS to MIN_GAP_SECONDS as the
//  speed ramp runs, because that is the only thing left that can make a run get
//  harder: with the gap held in seconds, raw speed no longer costs the runner
//  any reaction time, so without this the corridor would be exactly as hard at
//  two minutes as at five seconds and a good run would never end.
export const OPENING_GAP_SECONDS = 1.9;

// The opening allows time for a model round trip plus an action. The endgame
// deliberately squeezes that decision budget: these gaps still exceed the
// longest movement (a 0.57s jump), but slow answers will no longer keep up.
// Difficulty selects how soon the speed ramp reaches this pressure.
export const MIN_GAP_SECONDS: Record<Difficulty, number> = {
  easy:   0.85,
  medium: 0.78,
  hard:   0.72,
};

/** Extra spacing on top of MIN_GAP_SECONDS, so waves do not arrive on a metronome. */
export const GAP_JITTER_SECONDS = 0.25;

// ── Coins ─────────────────────────────────────────────────────────────────
export const COIN_VALUE         = 50;
export const COIN_CLUSTER_SIZE  = 4;
export const COIN_SPACING_Z     = 90;   // Z gap between coins in a cluster

// ── Scoring ────────────────────────────────────────────────────────────────
export const SCORE_PER_FRAME = 0.12;    // base score per frame at full speed
export const DIST_SCALE      = 0.008;   // cameraZ → displayed metres
