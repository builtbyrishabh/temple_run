// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-animation.ts  –  Do the runner's clips fit the actions they show?
//
// Run with `bun run check:animation`.
//
// The renderer trims each imported clip to the part of it that *is* the action,
// and then drives that trimmed range from the engine's own action progress. Two
// things can quietly break that, and neither shows up as a type error:
//
//   · the clips are replaced, and a trim range now points at the wrong frames,
//     or past the end of the take altogether
//   · JUMP_FRAMES or SLIDE_FRAMES is retuned, and the trimmed clip is suddenly
//     being played at half or double speed to fit the new window
//
// So this reads the frame ranges the renderer uses, reads the real durations out
// of the GLB, and checks the two still agree.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { JUMP_FRAMES, SLIDE_FRAMES } from '../lib/constants';
import { CLIP_TRIM, SOURCE_FPS } from '../lib/game/renderer3d';

const PLAYER_GLB = 'public/assets/glb/player1.glb';

/**
 * How far from 1:1 a clip may be stretched to cover its action window before it
 * stops reading as the movement it was animated as. Two is a fast tumble; four
 * is a blur.
 */
const MAX_PLAYBACK_RATE = 2.2;

/** Clip durations out of a GLB, without standing up a WebGL context to get them. */
function clipDurations(path: string): Map<string, number> {
  const buf = readFileSync(path);
  let offset = 12; // past the GLB header
  let gltf: any = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const kind = buf.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) {
      gltf = JSON.parse(buf.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }

  const durations = new Map<string, number>();
  for (const animation of gltf.animations ?? []) {
    // A sampler's input accessor holds keyframe times, and its `max` is the
    // last of them — which is the clip's length.
    const seconds = Math.max(
      ...animation.channels.map((channel: any) => {
        const accessor = gltf.accessors[animation.samplers[channel.sampler].input];
        return accessor.max ? accessor.max[0] : 0;
      }),
    );
    durations.set(animation.name, seconds);
  }
  return durations;
}

/** Frames the engine gives each action. `die` is not an action; it plays untimed. */
const ACTION_FRAMES: Record<string, number | null> = {
  jump: JUMP_FRAMES,
  roll: SLIDE_FRAMES,
  die: null,
};

let failures = 0;

function check(what: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  ok    ${what} — ${detail}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${what} — ${detail}`);
}

const durations = clipDurations(PLAYER_GLB);
console.log(`\n${PLAYER_GLB}`);

for (const [name, [from, to]] of Object.entries(CLIP_TRIM)) {
  const source = durations.get(name);
  if (source === undefined) {
    check(name, false, 'no clip of that name in the file');
    continue;
  }

  const sourceFrames = source * SOURCE_FPS;
  const trimmed = (to - from) / SOURCE_FPS;

  check(
    `${name} is trimmed inside its take`,
    from >= 0 && to > from && to <= Math.ceil(sourceFrames),
    `f${from}–f${to} of ${sourceFrames.toFixed(0)} frames (${source.toFixed(2)}s)`,
  );

  const frames = ACTION_FRAMES[name];
  if (frames === null) continue;

  // The renderer maps the trimmed clip onto the action window, so this is how
  // fast it ends up running.
  const window = frames / 60;
  const rate = trimmed / window;
  check(
    `${name} covers its ${(window * 1000).toFixed(0)}ms window`,
    rate <= MAX_PLAYBACK_RATE,
    `${trimmed.toFixed(3)}s of clip over ${window.toFixed(3)}s → ${rate.toFixed(2)}× speed`,
  );
}

console.log(failures === 0 ? '\nall clips fit\n' : `\n${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
