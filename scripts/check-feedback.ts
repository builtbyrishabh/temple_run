import { collisionEntryZ, PLAYER_Z } from '../lib/constants';
import { initGameState, updateGame } from '../lib/game/engine';
import { TURN_SIGN_Z } from '../lib/game/renderer3d';
import type { InputState } from '../types/game';

const NO_INPUT: InputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  pause: false,
};

function check(what: string, ok: boolean): void {
  if (!ok) throw new Error(`FAIL ${what}`);
  console.log(`  ok    ${what}`);
}

console.log('\nrenderer feedback events');

check('the turn arrow sits on the camera-facing side of its gate', TURN_SIGN_Z > 0);

{
  const state = initGameState('medium', 0);
  state.status = 'playing';
  state.coinItems.push({ id: 1, lane: 1, worldZ: PLAYER_Z + state.speed, collected: false });

  updateGame(state, NO_INPUT);

  check(
    'collecting a coin emits its lane and world position',
    state.events.some(event =>
      event.kind === 'coin' && event.lane === 1 && event.worldZ === PLAYER_Z + 8),
  );
}

{
  const state = initGameState('medium', 0);
  state.status = 'playing';
  state.obstacles.push({
    id: 1,
    type: 'WALL',
    lane: 1,
    worldZ: collisionEntryZ('WALL') + state.speed - 1,
    passed: false,
  });

  updateGame(state, NO_INPUT);

  check('a fatal collision emits one crash event', state.events.length === 1);
  const crash = state.events[0];
  check(
    'the crash identifies its lane, obstacle, and world position',
    crash?.kind === 'crash'
      && crash.lane === 1
      && crash.obstacle === 'WALL'
      && crash.worldZ === state.obstacles[0]?.worldZ,
  );
}

console.log('\nall feedback scenarios passed\n');
