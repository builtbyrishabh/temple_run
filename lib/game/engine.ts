// ─────────────────────────────────────────────────────────────────────────────
// lib/game/engine.ts  –  Mutable game-state + per-frame update logic
// ─────────────────────────────────────────────────────────────────────────────

import {
  INITIAL_SPEED, MAX_SPEED, SPEED_INCREASE,
  JUMP_HEIGHT, JUMP_FRAMES, SLIDE_FRAMES,
  LANE_CHANGE_FRAMES, PLAYER_Z, COIN_VALUE,
  SCORE_PER_FRAME, DIST_SCALE, COIN_CLUSTER_SIZE, COIN_SPACING_Z,
  SPAWN_Z, OPENING_GAP_SECONDS, MIN_GAP_SECONDS, GAP_JITTER_SECONDS,
  PLAYER_WORLD_HEIGHT, SLIDE_HEIGHT, HIGH_BAR_BOTTOM, LOW_WALL_HEIGHT,
  collisionHalfDepth,
} from '../constants';
import { lerp, pick, randInt } from '../utils';
import type {
  GameState, Player, RunEvent,
  InputState, Difficulty, Lane, ObstacleType,
} from '../../types/game';

// ── Obstacle templates per difficulty ────────────────────────────────────────

/** Lane patterns:  each element is [obstacleType, lane (-1 = all)]  */
type Pattern = Array<[ObstacleType, Lane | -1]>;

// Every pattern below is answerable from every lane with a *single* move, and
// `isAnswerableFrom` is what makes that true rather than intended. The
// difficulty curve is therefore built out of what a wave asks for, never out of
// whether an answer exists at all:
//
//   easy    starts with one lane blocked, then introduces medium patterns
//   medium  two lanes blocked; the one way through has to be found
//   hard    waves that fill the corridor, and the heaviest share of walls —
//           the only obstacle answerable solely by a sideways step, which is
//           also the only move a stale decision ruins

const EASY_PATTERNS: Pattern[] = [
  [['LOW_WALL', 0]],
  [['LOW_WALL', 1]],
  [['LOW_WALL', 2]],
  [['HIGH_BAR', 0]],
  [['HIGH_BAR', 1]],
  [['HIGH_BAR', 2]],
  [['WALL', 0]],
  [['WALL', 1]],
  [['WALL', 2]],
];

const MEDIUM_PATTERNS: Pattern[] = [
  [['LOW_WALL', -1]],                                  // jump, whichever lane it is in
  [['HIGH_BAR', -1]],                                  // slide, whichever lane it is in
  [['LOW_WALL', 0], ['LOW_WALL', 2]],
  [['HIGH_BAR', 0], ['HIGH_BAR', 2]],
  [['LOW_WALL', 0], ['HIGH_BAR', 2]],
  [['HIGH_BAR', 0], ['LOW_WALL', 2]],
  [['WALL', 1]],                                       // off the middle, either way
  [['HIGH_BAR', 0], ['WALL', 2]],
];

const HARD_PATTERNS: Pattern[] = [
  [['LOW_WALL', 0], ['HIGH_BAR', 1], ['LOW_WALL', 2]], // jump or slide, by lane
  [['HIGH_BAR', 0], ['LOW_WALL', 1], ['HIGH_BAR', 2]],
  [['LOW_WALL', -1]],
  [['HIGH_BAR', -1]],
  [['WALL', 0], ['WALL', 2]],                          // the middle, and only the middle
  [['WALL', 1], ['LOW_WALL', 0]],                      // step, and pay for it
  [['WALL', 1], ['HIGH_BAR', 2]],
  [['HIGH_BAR', 0], ['WALL', 2]],
  [['WALL', 0], ['LOW_WALL', 2]],
];

// Late waves mostly fill all three lanes, so holding one safe lane cannot
// sustain a run. The two train patterns keep lane changes in the mix.
const ENDGAME_PATTERNS = ([
  [['LOW_WALL', -1]],
  [['HIGH_BAR', -1]],
  [['LOW_WALL', 0], ['HIGH_BAR', 1], ['LOW_WALL', 2]],
  [['HIGH_BAR', 0], ['LOW_WALL', 1], ['HIGH_BAR', 2]],
  [['LOW_WALL', 0], ['LOW_WALL', 1], ['HIGH_BAR', 2]],
  [['HIGH_BAR', 0], ['HIGH_BAR', 1], ['LOW_WALL', 2]],
  [['WALL', 0], ['WALL', 2]],
  [['WALL', 1]],
] satisfies Pattern[]).filter(isAnswerableFromAnyLane);

/**
 * The tables above, filtered to the waves a runner can actually answer. Doing
 * it once here rather than at every spawn keeps it off the per-frame path and
 * makes the rule a property of the content: a pattern added to a table that no
 * single move survives simply never appears in a run.
 */
const PATTERNS: Record<Difficulty, Pattern[]> = {
  easy: EASY_PATTERNS.filter(isAnswerableFromAnyLane),
  medium: MEDIUM_PATTERNS.filter(isAnswerableFromAnyLane),
  hard: HARD_PATTERNS.filter(isAnswerableFromAnyLane),
};

/** What a pattern leaves in each lane. A solid wall outranks anything clearable. */
function patternByLane(pattern: Pattern): Record<Lane, ObstacleType | null> {
  const byLane: Record<Lane, ObstacleType | null> = { 0: null, 1: null, 2: null };
  for (const [type, lane] of pattern) {
    for (const l of [0, 1, 2] as const) {
      if (lane !== -1 && lane !== l) continue;
      if (byLane[l] === 'WALL') continue;
      byLane[l] = type === 'WALL' ? 'WALL' : (byLane[l] ?? type);
    }
  }
  return byLane;
}

/** Is the wave answerable wherever the runner happens to be when it arrives? */
function isAnswerableFromAnyLane(pattern: Pattern): boolean {
  const byLane = patternByLane(pattern);
  return ([0, 1, 2] as const).every(lane => isAnswerableFrom(byLane, lane));
}

/**
 * Can a runner standing in `lane` survive this wave with a *single* move?
 *
 * Whoever is driving gets one move per wave — hold, jump, slide, or step one
 * lane — because a second one costs another round trip and the wave will not
 * wait that long. So a pattern needing two is not a hard wave, it is an
 * unavoidable death: walls left and right with a bar between them reads as a
 * fair test of nerve and is survivable only from the middle lane.
 *
 * Note what this deliberately does *not* count as an answer: stepping into a
 * lane holding a low wall or a high bar. Clearing that needs the step and then
 * the jump, which is two moves.
 */
function isAnswerableFrom(byLane: Record<Lane, ObstacleType | null>, lane: Lane): boolean {
  const here = byLane[lane];
  if (here === null) return true;                                    // hold
  if (here === 'LOW_WALL') return true;                              // jump
  if (here === 'HIGH_BAR') return true;                              // slide
  if (lane > 0 && byLane[(lane - 1) as Lane] === null) return true;  // step left
  if (lane < 2 && byLane[(lane + 1) as Lane] === null) return true;  // step right
  return false;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

function makePlayer(): Player {
  return {
    lane: 1, targetLane: 1, laneT: 1,
    action: 'running', actionT: 0, actionDuration: 1,
    worldY: 0,
  };
}

export function initGameState(difficulty: Difficulty, highScore: number): GameState {
  const state: GameState = {
    status: 'starting',
    difficulty,
    score: 0,
    distance: 0,
    coins: 0,
    speed: INITIAL_SPEED,
    cameraZ: 0,
    player: makePlayer(),
    obstacles: [],
    coinItems: [],
    events: [],
    highScore,
    // Opening beats, near enough to arrive promptly rather than after a full
    // SPAWN_Z of empty corridor.
    nextObstacleZ: 1600,
    nextCoinZ: 900,
    frameCount: 0,
    idCounter: 0,
  };
  return state;
}

// ── Main update (called every frame) ─────────────────────────────────────────

export function updateGame(state: GameState, input: InputState): void {
  if (state.status !== 'playing') return;

  // Events belong to the step that produced them and to no other.
  state.events.length = 0;
  state.frameCount++;

  // Speed ramp-up
  state.speed = Math.min(MAX_SPEED, state.speed + SPEED_INCREASE[state.difficulty]);

  // Advance camera
  state.cameraZ += state.speed;
  state.distance = state.cameraZ * DIST_SCALE;

  // Score (proportional to speed)
  state.score += SCORE_PER_FRAME * (state.speed / INITIAL_SPEED);

  updatePlayer(state, input);
  spawnWorld(state);
  checkCollisions(state);
  pruneOld(state);
}

// ── Player update ─────────────────────────────────────────────────────────────

function updatePlayer(state: GameState, input: InputState): void {
  const p = state.player;

  // ── Lane transition ──────────────────────────────────────────────────────
  if (p.laneT < 1) {
    p.laneT = Math.min(1, p.laneT + 1 / LANE_CHANGE_FRAMES);
    if (p.laneT >= 1) p.lane = p.targetLane;
  }

  // ── State machine ────────────────────────────────────────────────────────
  if (p.action !== 'running') {
    p.actionT += 1 / p.actionDuration;
    if (p.actionT >= 1) {
      p.actionT = 1;
      p.action = 'running';
      p.worldY = 0;
    } else if (p.action === 'jumping') {
      // Sine arc: up and back down
      p.worldY = JUMP_HEIGHT * Math.sin(p.actionT * Math.PI);
    } else {
      p.worldY = 0; // a slide stays on the ground
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────
  // Lane changes are allowed even mid-jump/slide
  const canChangeLane = p.laneT >= 1 || p.targetLane !== p.lane;

  if (input.left && p.targetLane > 0) {
    if (canChangeLane) {
      p.targetLane = (p.targetLane - 1) as Lane;
      p.lane = (p.targetLane + 1) as Lane; // start transition from current visual
      p.laneT = 0;
    }
  }
  if (input.right && p.targetLane < 2) {
    if (canChangeLane) {
      p.targetLane = (p.targetLane + 1) as Lane;
      p.lane = (p.targetLane - 1) as Lane;
      p.laneT = 0;
    }
  }
  if (input.up && p.action === 'running') {
    p.action = 'jumping';
    p.actionT = 0;
    p.actionDuration = JUMP_FRAMES;
  }
  if (input.down && p.action === 'running') {
    p.action = 'sliding';
    p.actionT = 0;
    p.actionDuration = SLIDE_FRAMES;
  }
}

// ── World spawning ────────────────────────────────────────────────────────────

function spawnWorld(state: GameState): void {
  const frontZ = state.cameraZ + SPAWN_Z;

  // Everything is placed at the Z it was scheduled for rather than at frontZ.
  // The two are within one frame of each other in steady state, but using the
  // schedule keeps spacing exact, and it lets a run open with a wave nearer
  // than SPAWN_Z instead of an empty corridor while the first one closes.
  if (frontZ >= state.nextObstacleZ) {
    const atZ = state.nextObstacleZ;
    spawnObstacleCluster(state, atZ);
    state.nextObstacleZ = atZ + secondsToZ(state, gapSeconds(state));
  }

  // Spawn coins
  if (frontZ >= state.nextCoinZ) {
    const atZ = state.nextCoinZ;
    spawnCoinCluster(state, atZ);
    state.nextCoinZ = atZ + secondsToZ(state, 1.0 + Math.random() * 0.6);
  }
}

/**
 * Seconds of corridor between this wave and the next. Tightens from
 * OPENING_GAP_SECONDS to the difficulty's MIN_GAP_SECONDS in step with the
 * speed ramp, so the run gets harder in the one dimension the runner actually
 * feels — how long it has to answer. Late gaps allow the movement itself,
 * but increasingly punish decision latency.
 */
function gapSeconds(state: GameState): number {
  // Leave the opening reaction budget intact before tightening the course.
  const ramp = Math.max(0, (state.speed - 12) / (MAX_SPEED - 12));
  return lerp(OPENING_GAP_SECONDS, MIN_GAP_SECONDS[state.difficulty], ramp)
    + Math.random() * GAP_JITTER_SECONDS;
}

/**
 * World-Z the corridor covers in `seconds` — measured at the speed it will be
 * moving at when the runner gets there, not the speed it is moving at now.
 *
 * Waves are placed SPAWN_Z ahead, which is several seconds of travel, and the
 * corridor is still accelerating over that stretch. Converting at today's speed
 * therefore lays out a gap that has quietly shrunk by the time it is answered —
 * the further ahead the world is built, the worse the error, and on hard it was
 * worth a third of the gap.
 */
function secondsToZ(state: GameState, seconds: number): number {
  const framesUntilReached = SPAWN_Z / state.speed;
  const speedThen = Math.min(
    MAX_SPEED,
    state.speed + SPEED_INCREASE[state.difficulty] * framesUntilReached,
  );
  return seconds * 60 * speedThen;
}

function spawnObstacleCluster(state: GameState, atZ: number): void {
  // Introduce complexity gradually, independently of the speed/spacing ramp.
  // The first stretch uses single obstacles on every difficulty; easy later
  // mixes in medium patterns. Above speed 16, every mode progressively adds
  // endgame waves until they become the entire course at maximum speed.
  const seconds = state.frameCount / 60;
  const variety = Math.min(1, Math.max(0, (seconds - 8) / 35));
  const advanced = state.difficulty === 'easy' ? 'medium' : state.difficulty;
  const latePressure = Math.max(0, (state.speed - 16) / (MAX_SPEED - 16));
  const regular = PATTERNS[Math.random() < variety ? advanced : 'easy'];
  const chosen = pick(latePressure > 0 && Math.random() < latePressure ? ENDGAME_PATTERNS : regular);
  // Mirroring preserves adjacency and answerability, while avoiding a bias
  // toward the middle/right arrangements in the authored pattern table.
  const mirror = Math.random() < 0.5;
  for (const [type, lane] of chosen) {
    state.obstacles.push({
      id: ++state.idCounter,
      type,
      lane: lane === -1 ? -1 : mirror ? (2 - lane) as Lane : lane,
      worldZ: atZ,
      passed: false,
    });
  }
}

function spawnCoinCluster(state: GameState, atZ: number): void {
  const lane = randInt(0, 2) as Lane;
  for (let i = 0; i < COIN_CLUSTER_SIZE; i++) {
    state.coinItems.push({
      id: ++state.idCounter,
      lane,
      worldZ: atZ + i * COIN_SPACING_Z,
      collected: false,
    });
  }
}

// ── Collision detection ───────────────────────────────────────────────────────

function checkCollisions(state: GameState): void {
  const p = state.player;

  // Current effective lane (interpolated during transition)
  const effectiveLane = p.laneT < 1
    ? (p.laneT < 0.5 ? p.lane : p.targetLane)
    : p.lane;

  const camZ = state.cameraZ;

  // ── Obstacles ────────────────────────────────────────────────────────────
  // Depth is an overlap between two boxes, not a test at a single plane: the
  // obstacle owns OBSTACLE_DEPTH of corridor around its worldZ and the runner
  // owns PLAYER_DEPTH around PLAYER_Z. An obstacle is only spent once its back
  // edge has cleared the runner's front edge, which is what makes a train block
  // the lane for the whole 430 units it is drawn over.
  for (const obs of state.obstacles) {
    if (obs.passed) continue;

    const offset = (obs.worldZ - camZ) - PLAYER_Z;
    const half = collisionHalfDepth(obs.type);
    if (offset > half) continue;            // not alongside the runner yet
    if (offset < -half) { obs.passed = true; continue; }  // gone by, cleared

    if (obs.lane !== -1 && obs.lane !== effectiveLane) continue;
    if (!blocksVertically(obs.type, p)) continue;

    obs.passed = true;
    endRun(state, { kind: 'crash', lane: effectiveLane, worldZ: obs.worldZ, obstacle: obs.type });
    return;
  }

  // ── Coins ────────────────────────────────────────────────────────────────
  for (const coin of state.coinItems) {
    if (coin.collected) continue;
    const depth = coin.worldZ - camZ;
    if (Math.abs(depth - PLAYER_Z) > 80) continue;
    if (coin.lane !== effectiveLane) continue;

    coin.collected = true;
    state.coins++;
    state.score += COIN_VALUE;
    state.events.push({ kind: 'coin', lane: coin.lane, worldZ: coin.worldZ });
  }
}

/**
 * Does this obstacle occupy the vertical space the runner is in?
 *
 * The runner is a box from its feet (worldY) to its head, and a slide is what
 * makes that box short enough to pass under a bar. Testing the head rather than
 * the feet is the whole fix: a standing runner has worldY = 0, so the old test
 * for feet above the bar's underside concluded that bars never hit anyone.
 */
function blocksVertically(type: ObstacleType, p: Player): boolean {
  switch (type) {
    case 'WALL':     return true;                          // too tall to clear, reaches the ground
    case 'LOW_WALL': return p.worldY < LOW_WALL_HEIGHT;    // cleared by jumping over it
    case 'HIGH_BAR': return playerTop(p) > HIGH_BAR_BOTTOM; // cleared by sliding under it
  }
}

/** Height of the top of the runner's box. A slide is the only thing that lowers it. */
function playerTop(p: Player): number {
  return p.worldY + (p.action === 'sliding' ? SLIDE_HEIGHT : PLAYER_WORLD_HEIGHT);
}

// ── End of run ────────────────────────────────────────────────────────────────

/**
 * One contact ends the run: no lives, no stumble, no protection window. The
 * corridor is answered or it is not, and the runner gets one move per wave to
 * answer it with.
 */
function endRun(state: GameState, crash: Extract<RunEvent, { kind: 'crash' }>): void {
  if (state.status !== 'playing') return;
  state.status = 'gameover';
  state.events.push(crash);
  if (state.score > state.highScore) state.highScore = Math.floor(state.score);
}

function pruneOld(state: GameState): void {
  state.obstacles  = state.obstacles.filter(o => o.worldZ > state.cameraZ - 200);
  state.coinItems  = state.coinItems.filter(c => c.worldZ > state.cameraZ - 200);
}
