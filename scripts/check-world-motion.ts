// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-world-motion.ts  –  Does the corridor move like forward travel?
//
// Run with `npm run check:world-motion`.
//
// The renderer keeps the runner near the camera, so the travel illusion depends
// on nearby track detail advancing continuously while recycled scenery wraps at
// the same world position. These checks lock down that motion arithmetic without
// standing up WebGL.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  recycledRowZ,
  trackTravelOffset,
} from '../lib/game/three/motion';

assert.equal(trackTravelOffset(0, 66), 0);
assert.equal(trackTravelOffset(70, 66), 4);
assert.equal(trackTravelOffset(136, 66), 4);

// In renderer space, positive Z moves track detail toward the camera. Advancing
// the run must therefore increase the offset until the repeating row wraps.
assert.ok(
  trackTravelOffset(71, 66) > trackTravelOffset(70, 66),
  'track detail should move toward the camera as forward travel increases',
);

// Moving one complete recycling span must return an object to the same hidden
// slot instead of producing a visible jump at a different depth.
assert.equal(recycledRowZ(100, 1, 400, 4, 120), -420);
assert.equal(recycledRowZ(1700, 1, 400, 4, 120), -420);

console.log('\nworld motion checks passed\n');
