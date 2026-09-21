// ─────────────────────────────────────────────────────────────────────────────
// lib/jev/timing.ts  –  The arithmetic Jev is never asked to do
//
// Jev decides *which* action to take. Deciding *when* the button goes down is
// pure kinematics, derived here from the game's own constants so the sensing
// layer (which tells Jev whether an action is still possible) and the control
// layer (which presses the button) can never disagree about the numbers.
// ─────────────────────────────────────────────────────────────────────────────

import {
  JUMP_FRAMES, JUMP_HEIGHT, LOW_WALL_HEIGHT, SLIDE_FRAMES,
  LANE_CHANGE_FRAMES, PLAYER_Z, collisionEntryZ, collisionHalfDepth,
} from '../constants';
import type { SolidObstacleType } from '../../types/game';

// ── The collision window ─────────────────────────────────────────────────────
// The engine does not resolve a collision at a single depth: an obstacle and
// the runner are boxes, and contact lasts for as long as the two overlap. So a
// jump has to stay high for that whole stretch, and how long that takes depends
// both on how deep the obstacle is and on how fast the corridor is moving —
// which is why the leads below are functions of speed rather than constants.
//
// The depths themselves come from the game layer, so this cannot drift from
// what the engine enforces or from what the renderer draws.

/** Frames the runner spends overlapping an obstacle of `type`. */
function framesInsideWindow(type: SolidObstacleType, speed: number): number {
  return (2 * collisionHalfDepth(type)) / speed;
}

/** Frames until an obstacle at `worldZ` first becomes able to hit the runner. */
export function framesToImpact(
  worldZ: number, cameraZ: number, speed: number, type: SolidObstacleType,
): number {
  return (worldZ - cameraZ - collisionEntryZ(type)) / speed;
}

/** Frames until something with no footprint — a coin — draws level with the runner. */
export function framesToRunner(worldZ: number, cameraZ: number, speed: number): number {
  return (worldZ - cameraZ - PLAYER_Z) / speed;
}

// ── Jump ─────────────────────────────────────────────────────────────────────
// The arc is worldY = JUMP_HEIGHT · sin(t·π) over JUMP_FRAMES, and a LOW_WALL
// is cleared while worldY >= LOW_WALL_HEIGHT. Solving for t gives the slice of
// the arc that is actually high enough.

const CLEAR_FRACTION = Math.asin(Math.min(1, LOW_WALL_HEIGHT / JUMP_HEIGHT)) / Math.PI;

/** Earliest frame after take-off at which the runner is above a low wall. */
export const JUMP_CLEARS_FROM = Math.ceil(CLEAR_FRACTION * JUMP_FRAMES);
/** Last such frame. */
export const JUMP_CLEARS_UNTIL = Math.floor((1 - CLEAR_FRACTION) * JUMP_FRAMES);

const JUMP_SPAN = JUMP_CLEARS_UNTIL - JUMP_CLEARS_FROM;

/** Frames before entry to take off, so the high part of the arc straddles the window. */
export function jumpLead(speed: number): number {
  return (JUMP_CLEARS_FROM + JUMP_CLEARS_UNTIL - framesInsideWindow('LOW_WALL', speed)) / 2;
}

// ── Slide ────────────────────────────────────────────────────────────────────
// A HIGH_BAR is cleared for as long as the slide lasts, so the only constraint
// is being in the slide for the whole window.

const SLIDE_CLEARS_UNTIL = SLIDE_FRAMES - 1;

/** Frames before entry to drop into a slide, centred on the window. */
export function slideLead(speed: number): number {
  return (SLIDE_CLEARS_UNTIL - framesInsideWindow('HIGH_BAR', speed)) / 2;
}

// ── Lane change ──────────────────────────────────────────────────────────────
// Collisions use the destination lane once the transition passes halfway, so a
// step only counts if it has had LANE_CHANGE_FRAMES/2 frames to run before the
// window opens. One extra frame of margin.

export const LANE_CHANGE_COUNTS_AFTER = Math.ceil(LANE_CHANGE_FRAMES / 2) + 1;

/**
 * Minimum press-to-press gap for lane changes. The engine already ignores a
 * second step taken mid-transition; this just stops the control layer burning
 * presses on inputs that cannot land.
 */
export const PRESS_COOLDOWN_FRAMES = LANE_CHANGE_FRAMES;

/** How far ahead a threat has to be before it is worth asking Jev about it. */
export const DECISION_HORIZON_FRAMES = 132;

/**
 * How often a decision is requested while something is close enough to matter.
 *
 * Lives here rather than in the control layer because the simulator runs the
 * same schedule without the React hook, and the two drifting apart would make
 * every measurement a lie.
 */
export const DECISION_INTERVAL_MS = 140;

/** Is there still time for a sideways step to count before the window opens? */
export function canStillStep(frames: number): boolean {
  return frames >= LANE_CHANGE_COUNTS_AFTER;
}

/** Can a jump still be timed to cover this obstacle's whole window? */
export function canStillJump(frames: number, speed: number): boolean {
  return frames >= JUMP_CLEARS_FROM && framesInsideWindow('LOW_WALL', speed) <= JUMP_SPAN;
}

/** Can a slide still be timed to cover this obstacle's whole window? */
export function canStillSlide(frames: number, speed: number): boolean {
  return frames >= 1 && framesInsideWindow('HIGH_BAR', speed) <= SLIDE_CLEARS_UNTIL;
}

/**
 * The obstacle each airborne action is timed against: a jump answers a low
 * wall and a slide a high bar, so those are the footprints the control layer
 * measures its lead from.
 */
export const TIMED_AGAINST: Record<'jump' | 'slide', SolidObstacleType> = {
  jump: 'LOW_WALL',
  slide: 'HIGH_BAR',
};

/** Frames as a phrase, because a sign or a decimal is one more hop for Jev to make. */
export function describeDelay(frames: number): string {
  if (frames <= 0) return 'it is already alongside the runner';
  const seconds = frames / 60;
  if (seconds < 0.35) return 'about a third of a second';
  if (seconds < 0.75) return `about ${(Math.round(seconds * 10) / 10).toFixed(1)} seconds`;
  return `about ${Math.round(seconds * 2) / 2} seconds`;
}
