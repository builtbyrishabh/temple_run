// ─────────────────────────────────────────────────────────────────────────────
// scripts/simulate.ts  –  The decision loop, headless, without the model
//
//   bun run scripts/simulate.ts [runs] [difficulty] [serial]
//
// Runs the real engine, the real sensors and the real scheduler against a
// *reference pilot* — a rule that reads the same payload Jev reads — under a
// latency distribution matching Jev's measured round trip. Runs are seeded by
// index, so two versions of the loop are compared over the same worlds.
//
// The point is to isolate the loop from the model. If the runner dies here it
// is the loop's fault, not Jev's, and no amount of prompting will fix it.
// Pass `serial` as the third argument to measure the un-pipelined loop instead.
// ─────────────────────────────────────────────────────────────────────────────

import { initGameState, updateGame } from '../lib/game/engine';
import { readSensors } from '../lib/jev/sensors';
import {
  DECISION_INTERVAL_MS, PRESS_COOLDOWN_FRAMES, TIMED_AGAINST, framesToImpact,
  jumpLead, slideLead,
} from '../lib/jev/timing';
import type { RunnerAction, Sensors } from '../lib/jev/contract';
import type { Difficulty, InputState } from '../types/game';

const FRAME_MS = 1000 / 60;
/** Two minutes is long enough to see the speed cap. `CAP_SECONDS=300` to see past it. */
const CAP_FRAMES = 60 * Number(process.env.CAP_SECONDS ?? 120);

const NO_INPUT: InputState = { left: false, right: false, up: false, down: false, pause: false };

/**
 * Every run is seeded, so a median that moves between two versions of the loop
 * moved because the loop changed. The engine, the latency sample and the coin
 * layout all draw from `Math.random`, so the seed is installed globally for the
 * duration of a run rather than threaded through the game.
 */
function seedRandom(seed: number): void {
  let a = seed * 0x9e3779b9 >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Measured against the live model through the gateway: 378ms fastest, 428ms
 * median, 608ms slowest over a sample of calls with this exact payload. Modelled
 * as a floor plus a skewed tail rather than a flat range, because the floor is
 * what the corridor speed has to be fair to.
 */
function sampleLatency(): number {
  return 370 + Math.round(280 * Math.random() ** 1.8);
}

/**
 * The reference pilot. Not a model and not a stand-in for one — it scores the
 * same five consequence sentences Jev reads and takes the best, which is the
 * floor any real decision maker should clear.
 */
function referencePilot(sensors: Sensors): RunnerAction {
  const options: [RunnerAction, string][] = [
    ['none', sensors.ifItDoesNothing],
    ['jump', sensors.ifItJumps],
    ['slide', sensors.ifItSlides],
    ['left', sensors.ifItStepsLeft],
    ['right', sensors.ifItStepsRight],
  ];

  let best: RunnerAction = 'none';
  let bestScore = -Infinity;
  for (const [action, text] of options) {
    const value = scoreConsequence(text);
    if (value > bestScore) { bestScore = value; best = action; }
  }
  return best;
}

/**
 * Reads one consequence sentence as a number. Crucially, a low wall or a high
 * bar in the lane being stepped into is *survivable* — it costs the next
 * decision, not the run — while a solid wall is not.
 */
function scoreConsequence(text: string): number {
  if (/not possible|too late/.test(text)) return -100;
  if (/solid wall/.test(text)) return -100;
  if (/straight into|caught there by|where it meets/.test(text)) {
    return /low wall|high bar/.test(text) ? -10 : -100;
  }
  if (/clears the low wall|passes cleanly under/.test(text)) return 5;
  if (/changes nothing/.test(text)) return -1;
  if (/line of coins/.test(text)) return 2;
  if (/is clear/.test(text)) return 1;
  return 0;
}

interface Pending {
  arrivesAtFrame: number;
  action: RunnerAction;
  worldZ: number | null;
  seq: number;
  /** Lane the runner was in when the question was asked. */
  askedFromLane: number;
}

function simulate(difficulty: Difficulty, pipelined: boolean, seed: number) {
  seedRandom(seed);
  const state = initGameState(difficulty, 0);
  state.status = 'playing';

  let commitment: { action: RunnerAction; worldZ: number | null } | null = null;
  let cooldown = 0;
  let seq = 0;
  let applied = 0;
  let inFlight: Pending | null = null;
  const queue: Pending[] = [];
  const latencies: number[] = [];

  let nextAskFrame = 0;
  let frame = 0;
  let decisions = 0;

  for (; frame < CAP_FRAMES && state.status === 'playing'; frame++) {
    // ── Answers that have come back ──────────────────────────────────────────
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].arrivesAtFrame > frame) continue;
      const answer = queue.splice(i, 1)[0];
      if (inFlight?.seq === answer.seq) inFlight = null;
      if (answer.seq <= applied) continue; // overtaken by a newer answer
      applied = answer.seq;
      // A sideways step is relative to the lane it was asked about.
      const lateral = answer.action === 'left' || answer.action === 'right';
      if (lateral && state.player.targetLane !== answer.askedFromLane) continue;
      commitment = answer.action === 'none'
        ? null
        : { action: answer.action, worldZ: answer.worldZ };
    }

    // ── Asking ───────────────────────────────────────────────────────────────
    const serialBusy = !pipelined && inFlight !== null;
    if (frame >= nextAskFrame && !serialBusy) {
      const reading = readSensors(state);
      if (reading.worthAsking) {
        const latency = sampleLatency();
        latencies.push(latency);
        const pending: Pending = {
          arrivesAtFrame: frame + Math.ceil(latency / FRAME_MS),
          action: referencePilot(reading.sensors),
          worldZ: reading.threat?.worldZ ?? null,
          seq: ++seq,
          askedFromLane: state.player.targetLane,
        };
        queue.push(pending);
        inFlight = pending;
        decisions++;
      } else {
        commitment = null;
      }
      nextAskFrame = frame + Math.round(DECISION_INTERVAL_MS / FRAME_MS);
    }

    // ── Pressing (identical logic to hooks/useJevDriver) ─────────────────────
    let input: InputState = NO_INPUT;
    if (cooldown > 0) cooldown--;

    if (commitment && commitment.action !== 'none') {
      if (commitment.action === 'left' || commitment.action === 'right') {
        if (cooldown === 0) {
          input = { ...NO_INPUT, [commitment.action]: true };
          commitment = null;
          cooldown = PRESS_COOLDOWN_FRAMES;
        }
      } else {
        const frames = commitment.worldZ === null
          ? 0
          : framesToImpact(
              commitment.worldZ, state.cameraZ, state.speed, TIMED_AGAINST[commitment.action],
            );
        if (frames < 0) {
          commitment = null;
        } else if (frames <= (commitment.action === 'jump' ? jumpLead(state.speed) : slideLead(state.speed))) {
          input = { ...NO_INPUT, [commitment.action === 'jump' ? 'up' : 'down']: true };
          commitment = null;
          cooldown = PRESS_COOLDOWN_FRAMES;
        }
      }
    }

    updateGame(state, input);
  }

  latencies.sort((a, b) => a - b);
  return {
    distance: Math.floor(state.distance),
    score: Math.floor(state.score),
    coins: state.coins,
    survived: state.status === 'playing',
    seconds: +(frame / 60).toFixed(1),
    decisions,
    medianLatency: latencies[Math.floor(latencies.length / 2)] ?? 0,
    topSpeed: +state.speed.toFixed(1),
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────

const runs = Number(process.argv[2] ?? 10);
const difficulty = (process.argv[3] ?? 'medium') as Difficulty;
const pipelined = process.argv[4] !== 'serial';

console.log(
  `${runs} runs · ${difficulty} · ${pipelined ? 'pipelined' : 'serial'} loop · ` +
  `${DECISION_INTERVAL_MS}ms cadence · capped at ${CAP_FRAMES / 60}s\n`,
);

const results = Array.from({ length: runs }, (_, i) => simulate(difficulty, pipelined, i + 1));
const distances = results.map(r => r.distance).sort((a, b) => a - b);

for (const [i, r] of results.entries()) {
  console.log(
    `  run ${String(i + 1).padStart(2)}  ${String(r.distance).padStart(5)}m  ` +
    `${String(r.seconds).padStart(5)}s  score ${String(r.score).padStart(6)}  ` +
    `${r.decisions} decisions  ${r.survived ? 'survived' : 'crashed'}`,
  );
}

const median = distances[Math.floor(distances.length / 2)];
const mean = Math.round(distances.reduce((a, b) => a + b, 0) / distances.length);
const survived = results.filter(r => r.survived).length;
console.log(
  `\n  median ${median}m · mean ${mean}m · best ${distances.at(-1)}m · worst ${distances[0]}m · ` +
  `survived ${survived}/${runs} · median latency ${results[0].medianLatency}ms`,
);
