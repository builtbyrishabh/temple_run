import { readFileSync } from 'fs';
import { JUMP_FRAMES, SLIDE_FRAMES } from '../lib/constants';
import { CLIP_TRIM, SOURCE_FPS } from '../lib/game/renderer3d';

interface GltfAccessor {
  max?: number[];
}

interface GltfAnimation {
  name: string;
  channels: Array<{ sampler: number }>;
  samplers: Array<{ input: number }>;
}

interface GltfJson {
  accessors?: GltfAccessor[];
  animations?: GltfAnimation[];
}

const PLAYER_GLB = 'public/assets/glb/player1.glb';
const MAX_PLAYBACK_RATE = 2.2;

function clipDurations(path: string): Map<string, number> {
  const buffer = readFileSync(path);
  let offset = 12;
  let gltf: GltfJson | null = null;

  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const kind = buffer.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) {
      gltf = JSON.parse(
        buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'),
      ) as GltfJson;
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }

  if (!gltf) throw new Error(`${path} does not contain a JSON chunk`);

  const durations = new Map<string, number>();
  const accessors = gltf.accessors ?? [];
  for (const animation of gltf.animations ?? []) {
    const seconds = Math.max(
      ...animation.channels.map(channel => {
        const sampler = animation.samplers[channel.sampler];
        const accessor = sampler ? accessors[sampler.input] : undefined;
        return accessor?.max?.[0] ?? 0;
      }),
    );
    durations.set(animation.name, seconds);
  }
  return durations;
}

const actionFrames: Record<string, number | null> = {
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

  const frames = actionFrames[name];
  if (frames === null || frames === undefined) continue;

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
