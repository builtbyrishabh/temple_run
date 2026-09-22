import assert from 'node:assert/strict';
import { initGameState, updateGame } from '../lib/game/engine';
import type { InputState } from '../types/game';

const input: InputState = { left: false, right: false, up: false, down: false, pause: false };
const originalRandom = Math.random;
let seed = 42;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
try {
  const state = initGameState('easy', 0);
  const waves: { seconds: number; lanes: number }[] = [];
  for (let frame = 0; frame < 60 * 210; frame++) {
    state.status = 'playing'; // Measure the course independently of the driver.
    const before = state.idCounter;
    updateGame(state, input);
    if (frame === 60 * 90 - 1) assert(state.speed > 23, 'the speed ramp must be visible within 90 seconds');
    const spawned = state.obstacles.filter(o => o.id > before);
    if (spawned.length) {
      waves.push({ seconds: frame / 60, lanes: spawned.some(o => o.lane === -1) ? 3 : spawned.length });
    }
  }
  assert(waves.filter(w => w.seconds < 3).every(w => w.lanes === 1), 'opening waves should teach one obstacle at a time');
  assert(waves.some(w => w.seconds > 20 && w.seconds < 60 && w.lanes > 1), 'easy must introduce multi-lane challenges within a short demo');
  const late = waves.filter(w => w.seconds >= 150);
  const forced = late.filter(w => w.lanes === 3).length / late.length;
  assert(forced >= 0.6, 'endgame must force an action in most waves instead of leaving a safe lane');
  const meanGap = (late.at(-1)!.seconds - late[0].seconds) / (late.length - 1);
  assert(meanGap < 1.1, 'endgame waves must average less than 1.1 seconds apart');
  assert(meanGap > 0.6, 'endgame must still leave time to complete a jump');
  console.log(`Pacing passed: gentle opening, visible ramp, ${Math.round(forced * 100)}% forced late waves, ${meanGap.toFixed(2)}s endgame gaps.`);
} finally {
  Math.random = originalRandom;
}
