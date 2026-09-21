// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-collisions.ts  –  Does visible contact produce the right result?
//
// Run with `bun run check:collisions`. Each scenario drives the real engine over
// one obstacle at a known depth and asks only whether the run survived, so these
// check the rules as played rather than the arithmetic behind them.
//
// The jump and slide scenarios press on the schedule lib/jev/timing publishes.
// That is deliberate: if the leads the AI times its actions from ever stop
// clearing the window the engine enforces, these fail rather than the bot.
// ─────────────────────────────────────────────────────────────────────────────

import { initGameState, updateGame } from '../lib/game/engine';
import { PLAYER_Z } from '../lib/constants';
import { TIMED_AGAINST, framesToImpact, jumpLead, slideLead } from '../lib/jev/timing';
import type { GameState, InputState, Lane, ObstacleType } from '../types/game';

const NO_INPUT: InputState = { left: false, right: false, up: false, down: false, pause: false };

/** A run with nothing in it: these scenarios place their own single obstacle. */
function corridor(): GameState {
  const state = initGameState('medium', 0);
  state.status = 'playing';
  state.nextObstacleZ = Infinity;
  state.nextCoinZ = Infinity;
  return state;
}

/** Put one obstacle `ahead` units in front of the runner, in `lane`. */
function place(state: GameState, type: ObstacleType, lane: Lane, ahead: number): void {
  state.obstacles.push({
    id: 1, type, lane, worldZ: state.cameraZ + PLAYER_Z + ahead, passed: false,
  });
}

/** Advance until the obstacle is spent or the run ends. True if the runner lived. */
function survives(state: GameState, act: (state: GameState) => InputState = () => NO_INPUT): boolean {
  for (let frame = 0; frame < 600; frame++) {
    if (state.status !== 'playing') return false;
    if (state.obstacles.every(o => o.passed)) return true;
    updateGame(state, act(state));
  }
  throw new Error('the obstacle never resolved either way');
}

/** Presses once, at the moment the AI's timing layer says the action is due. */
function onSchedule(action: 'jump' | 'slide'): (state: GameState) => InputState {
  const key = action === 'jump' ? 'up' : 'down';
  let pressed = false;
  return state => {
    if (pressed) return NO_INPUT;
    const obs = state.obstacles[0];
    const frames = framesToImpact(obs.worldZ, state.cameraZ, state.speed, TIMED_AGAINST[action]);
    const lead = action === 'jump' ? jumpLead(state.speed) : slideLead(state.speed);
    if (frames > lead) return NO_INPUT;
    pressed = true;
    return { ...NO_INPUT, [key]: true };
  };
}

/** Steps sideways on the first frame, which is as early as a step can be taken. */
function stepTo(direction: 'left' | 'right'): (state: GameState) => InputState {
  let pressed = false;
  return () => {
    if (pressed) return NO_INPUT;
    pressed = true;
    return { ...NO_INPUT, [direction]: true };
  };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

let failures = 0;

function check(expectation: string, actual: boolean, expected: boolean): void {
  if (actual === expected) {
    console.log(`  ok    ${expectation}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${expectation} — survived: ${actual}, expected: ${expected}`);
}

console.log('\nhigh bar');
{
  // The bug this file was written for: a standing runner has worldY = 0, and the
  // old test asked whether its *feet* were above the bar's underside.
  const state = corridor();
  place(state, 'HIGH_BAR', 1, 900);
  check('a standing runner is stopped by an overhead bar', survives(state), false);
}
{
  const state = corridor();
  place(state, 'HIGH_BAR', 1, 900);
  check('a slide timed by lib/jev/timing passes under it', survives(state, onSchedule('slide')), true);
}
{
  const state = corridor();
  place(state, 'HIGH_BAR', 1, 900);
  check('jumping into it still hits', survives(state, onSchedule('jump')), false);
}
{
  const state = corridor();
  place(state, 'HIGH_BAR', 0, 900);
  check('a bar in another lane is not the runner\'s problem', survives(state), true);
}

console.log('\nlow wall');
{
  const state = corridor();
  place(state, 'LOW_WALL', 1, 900);
  check('running into a low wall hits', survives(state), false);
}
{
  const state = corridor();
  place(state, 'LOW_WALL', 1, 900);
  check('a jump timed by lib/jev/timing clears it', survives(state, onSchedule('jump')), true);
}
{
  const state = corridor();
  place(state, 'LOW_WALL', 1, 900);
  check('sliding into it hits, the slide being the wrong answer', survives(state, onSchedule('slide')), false);
}

console.log('\ntrain');
{
  const state = corridor();
  place(state, 'WALL', 1, 900);
  check('a train blocks its lane', survives(state), false);
}
{
  const state = corridor();
  place(state, 'WALL', 1, 900);
  check('stepping out of its lane clears it', survives(state, stepTo('left')), true);
}
{
  const state = corridor();
  place(state, 'WALL', 1, 900);
  check('neither jumping nor sliding saves the runner', survives(state, onSchedule('jump')), false);
}
{
  // A train is drawn 430 units long. Its centre sitting 200 ahead means its nose
  // is already through the runner, which the old fixed 220-unit window missed
  // entirely: you could clip the front of a train and run on.
  const state = corridor();
  place(state, 'WALL', 1, 200);
  check('contact starts at the nose, not at the centre', survives(state), false);
}
{
  // The same depth, for an obstacle that really is short: still safely ahead.
  const state = corridor();
  place(state, 'LOW_WALL', 1, 200);
  check('a short obstacle 200 ahead has not arrived yet', state.obstacles[0].passed, false);
}

console.log('\none hit ends the run');
{
  const state = corridor();
  place(state, 'WALL', 1, 900);
  survives(state);
  check('the first contact reaches game over', state.status === 'gameover', true);
}

console.log(failures === 0 ? '\nall scenarios passed\n' : `\n${failures} scenario(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
