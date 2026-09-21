// ─────────────────────────────────────────────────────────────────────────────
// lib/jev/sensors.ts  –  Game state → the corridor as Jev sees it
//
// Pure and read-only: it never touches the game state, and the game has no idea
// it exists. The shape it produces follows from Jev's documented weaknesses —
// every field is already measured from the runner, phrased as the consequence
// of one action, so the model is asked to judge a situation rather than work
// one out.
// ─────────────────────────────────────────────────────────────────────────────

import { collisionExitZ } from '../constants';
import type { GameState, Lane, Obstacle, ObstacleType } from '../../types/game';
import type { Sensors } from './contract';
import {
  DECISION_HORIZON_FRAMES, canStillJump, canStillSlide,
  canStillStep, describeDelay, framesToImpact, framesToRunner,
} from './timing';

/** Obstacles land within ±40 of their cluster's Z, so this gathers one wave. */
const CLUSTER_SPREAD = 120;

const LANE_NAMES = ['left', 'middle', 'right'] as const;

/**
 * What the control layer needs to know about the threat being decided on. Kept
 * out of `Sensors` on purpose: object ids and raw depths are bookkeeping for
 * the scheduler, and would only be noise to the model.
 */
export interface Threat {
  /** Stable identity, so the control layer can tell a new wave from the same one. */
  key: string;
  worldZ: number;
  frames: number;
}

export interface Reading {
  sensors: Sensors;
  /** The obstacle wave a jump or slide would be timed against, if there is one. */
  threat: Threat | null;
  /** False when nothing is close enough to be worth a decision. */
  worthAsking: boolean;
}

/** Read one frame of game state as a decision payload. */
export function readSensors(state: GameState): Reading {
  const { player, speed } = state;

  // The lane the runner is committed to — mid-step, that is where it is headed,
  // which is what matters for anything far enough away to decide about.
  const lane = player.targetLane;
  const wave = nextWave(state);
  const coinLane = nextCoinLane(state);

  const frames = wave ? wave.frames : Infinity;
  const canStep = canStillStep(frames);
  const airborne = player.action !== 'running';

  const sensors: Sensors = {
    stance: describeStance(state),

    threatIn: wave
      ? describeDelay(wave.frames)
      : 'nothing close enough to worry about',

    ifItDoesNothing: wave
      ? holdingLane(lane, wave.byLane[lane], coinLane)
      : 'it keeps running down an empty corridor',

    ifItStepsLeft: describeStep(state, 'left', wave, coinLane, canStep),
    ifItStepsRight: describeStep(state, 'right', wave, coinLane, canStep),

    ifItJumps: describeJump(wave?.byLane[lane] ?? null, wave, airborne, frames, speed),
    ifItSlides: describeSlide(wave?.byLane[lane] ?? null, wave, airborne, frames, speed),
  };

  return {
    sensors,
    threat: wave ? { key: wave.key, worldZ: wave.worldZ, frames: wave.frames } : null,
    worthAsking: wave !== null,
  };
}

// ── The next wave of obstacles ───────────────────────────────────────────────

interface Wave {
  key: string;
  worldZ: number;
  frames: number;
  /** What is waiting in each lane, indexed by lane. */
  byLane: Record<Lane, ObstacleType | null>;
}

function nextWave(state: GameState): Wave | null {
  const { cameraZ, speed } = state;

  let leader: Obstacle | null = null;
  for (const obs of state.obstacles) {
    if (obs.passed) continue;
    // The engine keeps testing an obstacle until its back edge has cleared the
    // runner, so one sitting alongside is still live: stepping into its lane
    // right now is still fatal, and an earlier version of this dropped it at
    // PLAYER_Z and cheerfully reported the lane as clear. A train stays live
    // for far longer than a hurdle, which is why the depth is per obstacle.
    if (obs.worldZ - cameraZ <= collisionExitZ(obs.type)) continue;
    // The far end is just as important. Nothing past the decision horizon is
    // the runner's problem yet, and describing it as if it were is worse than
    // saying nothing: every consequence line then answers a wave seconds away
    // instead of the corridor in front, so a lane that is clear right now reads
    // as blocked.
    if (framesToImpact(obs.worldZ, cameraZ, speed, obs.type) > DECISION_HORIZON_FRAMES) continue;
    if (!leader || obs.worldZ < leader.worldZ) leader = obs;
  }
  if (!leader) return null;

  const byLane: Record<Lane, ObstacleType | null> = { 0: null, 1: null, 2: null };
  let key = leader.id;

  for (const obs of state.obstacles) {
    if (obs.passed) continue;
    if (Math.abs(obs.worldZ - leader.worldZ) > CLUSTER_SPREAD) continue;
    if (obs.id < key) key = obs.id;

    for (const lane of [0, 1, 2] as const) {
      if (obs.lane !== -1 && obs.lane !== lane) continue;
      // A solid wall outranks anything clearable in the same lane.
      if (byLane[lane] === 'WALL') continue;
      byLane[lane] = obs.type === 'WALL' ? 'WALL' : (byLane[lane] ?? obs.type);
    }
  }

  return {
    key: `wave-${key}`,
    worldZ: leader.worldZ,
    frames: framesToImpact(leader.worldZ, cameraZ, speed, leader.type),
    byLane,
  };
}

// ── Coins ────────────────────────────────────────────────────────────────────

/** Lane of the nearest uncollected coin worth mentioning, if any. */
function nextCoinLane(state: GameState): Lane | null {
  let best: { lane: Lane; worldZ: number } | null = null;
  for (const coin of state.coinItems) {
    if (coin.collected) continue;
    const frames = framesToRunner(coin.worldZ, state.cameraZ, state.speed);
    if (frames < 0 || frames > DECISION_HORIZON_FRAMES) continue;
    if (!best || coin.worldZ < best.worldZ) best = { lane: coin.lane, worldZ: coin.worldZ };
  }
  return best ? best.lane : null;
}

// ── Phrasing ─────────────────────────────────────────────────────────────────

function describeStance(state: GameState): string {
  const p = state.player;
  const lane = LANE_NAMES[p.targetLane];
  switch (p.action) {
    case 'jumping':   return `in the air mid-jump, coming down in the ${lane} lane`;
    case 'sliding':   return `sliding along the ${lane} lane`;
    default:
      return p.laneT < 1
        ? `running, halfway through a step into the ${lane} lane`
        : `running in the ${lane} lane`;
  }
}

/** What is waiting in a lane, as a noun phrase. */
function obstaclePhrase(type: ObstacleType | null): string {
  switch (type) {
    case 'WALL':     return 'a solid wall that cannot be jumped or slid under';
    case 'LOW_WALL': return 'a low wall, low enough to jump over';
    case 'HIGH_BAR': return 'a high bar, high enough to slide under';
    default:         return 'clear';
  }
}

function withCoins(phrase: string, lane: Lane, coinLane: Lane | null): string {
  return coinLane === lane ? `${phrase}, and a line of coins runs through it` : phrase;
}

function holdingLane(lane: Lane, type: ObstacleType | null, coinLane: Lane | null): string {
  const name = LANE_NAMES[lane];
  if (!type) return withCoins(`it holds the ${name} lane, which is clear`, lane, coinLane);
  return `it runs straight into ${obstaclePhrase(type)} in the ${name} lane`;
}

function describeStep(
  state: GameState,
  direction: 'left' | 'right',
  wave: Wave | null,
  coinLane: Lane | null,
  canStep: boolean,
): string {
  const lane = state.player.targetLane;

  if (direction === 'left' ? lane === 0 : lane === 2) {
    return `not possible — it is already in the ${LANE_NAMES[lane]} lane`;
  }

  const dest = (direction === 'left' ? lane - 1 : lane + 1) as Lane;
  const type = wave?.byLane[dest] ?? null;

  if (wave && !canStep) {
    return type
      ? `it steps into the ${LANE_NAMES[dest]} lane and is caught there by ${obstaclePhrase(type)}`
      : `it steps toward the ${LANE_NAMES[dest]} lane, but the step cannot finish before impact — whatever is in the ${LANE_NAMES[lane]} lane still hits it`;
  }

  if (!type) {
    return withCoins(`it steps into the ${LANE_NAMES[dest]} lane, which is clear`, dest, coinLane);
  }
  return `it steps into the ${LANE_NAMES[dest]} lane, where it meets ${obstaclePhrase(type)}`;
}

function describeJump(
  type: ObstacleType | null,
  wave: Wave | null,
  airborne: boolean,
  frames: number,
  speed: number,
): string {
  if (airborne) return 'not possible — it is already off the ground and cannot jump again';
  if (!wave) return 'a hop over nothing; it changes nothing';
  if (!canStillJump(frames, speed)) return 'too late — it cannot get high enough before impact';

  switch (type) {
    case 'LOW_WALL': return 'it clears the low wall cleanly';
    case 'HIGH_BAR': return 'it jumps straight into the high bar';
    case 'WALL':     return 'it still hits the solid wall, which is far too tall to clear';
    default:         return 'there is nothing to clear in this lane; the hop changes nothing';
  }
}

function describeSlide(
  type: ObstacleType | null,
  wave: Wave | null,
  airborne: boolean,
  frames: number,
  speed: number,
): string {
  if (airborne) return 'not possible — it is already off the ground and cannot start a slide';
  if (!wave) return 'a slide under nothing; it changes nothing';
  if (!canStillSlide(frames, speed)) return 'too late — it cannot get down before impact';

  switch (type) {
    case 'HIGH_BAR': return 'it passes cleanly under the high bar';
    case 'LOW_WALL': return 'it slides straight into the low wall';
    case 'WALL':     return 'it still hits the solid wall, which reaches the ground';
    default:         return 'there is nothing to duck under in this lane; the slide changes nothing';
  }
}
