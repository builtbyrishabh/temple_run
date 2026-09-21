// ─────────────────────────────────────────────────────────────────────────────
// lib/game/renderer3d.ts  –  WebGL presentation of the same GameState
//
// A drop-in alternative to renderer.ts. It reads `GameState` and draws it with
// three.js; it never writes to it. The engine, the sensing layer and Jev are
// all unaware this file exists.
//
// Coordinate mapping from engine space to three space:
//   x  =  worldX                  lane centres, LANE_WORLD_X = [-72, 0, 72]
//   y  =  worldY                  0 is the ground, up is positive
//   z  = -(worldZ - cameraZ)      camera plane at 0, the track ahead negative
//
// so the runner always stands at z = -PLAYER_Z and obstacles slide toward it.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  LANE_WORLD_X, TRACK_HALF_W, PLAYER_Z, PLAYER_WORLD_HEIGHT,
  WALL_HEIGHT, LOW_WALL_HEIGHT, HIGH_BAR_BOTTOM, HIGH_BAR_THICKNESS,
  NEAR_Z, FAR_Z, OBSTACLE_DEPTH, INITIAL_SPEED, LANE_CHANGE_FRAMES,
} from '../constants';
import { clamp, lerp, smoothstep } from '../utils';
import type { GameState, Obstacle, Lane, RunEvent } from '../../types/game';

/** Width of one lane in world units. */
const LANE_W = (TRACK_HALF_W * 2) / 3;

// ── Camera framing ───────────────────────────────────────────────────────────
// High and well back, aimed down the corridor rather than at the runner. The
// runner is not the thing you need to read — the next two or three waves are,
// and a closer over-the-shoulder framing put them off the top of the screen.
const CAM_HEIGHT = 330;
const CAM_BACK = 700;
const CAM_LOOK_HEIGHT = 110;
const CAM_LOOK_AHEAD = 520;
// A narrow lens magnifies the corridor and crops the empty apron either side,
// which is what makes three lanes read as a corridor rather than a footpath.
// Quoted vertically, at the aspect below; `resize` holds the *horizontal* view
// constant past that, so a wide window frames the corridor rather than simply
// revealing more empty ground beside it.
const CAM_FOV = 40;
const CAM_BASE_ASPECT = 1.5;

/** How far the camera drifts sideways with the runner. Below 1 the corridor
 *  stays roughly centred, so a lane change reads as the runner moving. */
const CAM_LATERAL_FOLLOW = 0.55;

// ── Scene tuning ─────────────────────────────────────────────────────────────
/** Horizon colour. Fog resolves to this, so distance fades into the skyline. */
const SKY = 0xdceefc;
// Zenith colour, for the gradient — a flat sky left the upper half a white
// void. Kept close to SKY on purpose: fog resolves scenery to SKY, so the
// further the zenith drifts from it the more distant rooflines read as white
// holes punched in the sky rather than as haze.
const SKY_TOP = '#a9cde9';
// Fog has to finish before FAR_Z, because that is where obstacles are culled and
// a train must not appear out of clear air. Just as important is that the range
// be *long*: squeezed into a few hundred units it compresses into a handful of
// pixels and reads as a white wall across the track. Spread over thousands it
// reads as air, and the corridor looks like it carries on past the horizon.
const FOG_NEAR = 2200;
const FOG_FAR = 6000;
// Span (SPACING x SLOTS) runs well past FOG_FAR, so the row wraps inside the
// haze and the recycling is never visible.
const HOUSE_SPACING = 760;   // world units between houses along one side
const HOUSE_SLOTS = 9;       // instances per side, recycled as the camera moves
const HOUSE_HEIGHT = 440;
const HOUSE_MAX_WIDTH = 440;
const HOUSE_NEAR = 250;      // keep the nearest house ahead of the camera
/** Gap between the track edge and the near face of a house row. */
const HOUSE_SETBACK = 340;
const SLEEPER_SPACING = 48;  // world units per railway texture tile

// ── Runner animation ─────────────────────────────────────────────────────────
// These ranges isolate the actual move from longer run-jump-run source takes.
export const SOURCE_FPS = 30;
export const CLIP_TRIM: Record<string, readonly [number, number]> = {
  jump: [17, 34],
  roll: [10, 40],
  die: [10, 44],
};

/** The result overlay waits exactly long enough for the fatal reaction. */
export const DEATH_SECONDS = (CLIP_TRIM.die[1] - CLIP_TRIM.die[0]) / SOURCE_FPS;

/** Results wait for a loaded death clip, but a failed asset must not deadlock the run. */
export function deathAnimationComplete(
  runnerReady: boolean,
  runnerLoadFailed: boolean,
  elapsed: number,
): boolean {
  return runnerLoadFailed || (runnerReady && elapsed >= DEATH_SECONDS);
}

const CADENCE_EXPONENT = 0.35;
const FADE_RUN = 0.12;
const FADE_ACTION = 0.06;
const LEAN_RADIANS = 0.30;
const LAND_SQUASH = 0.14;
const LAND_SECONDS = 0.22;

const SHAKE_UNITS = 22;
const SHAKE_SECONDS = 0.35;
const SETTLE_SECONDS = 0.9;
/** Positive Z is the camera-facing side of a gate. */
export const TURN_SIGN_Z = 64;

const GLB = (name: string) => `/assets/glb/${name}.glb`;

export interface Renderer3D {
  /**
   * Draw one frame of the given state. Safe to call before assets finish
   * loading. `lerp` is the fraction of a simulation step already owed but not
   * yet taken — the caller runs a fixed 60Hz step, so on a faster display this
   * is what keeps the corridor sliding instead of advancing in visible jerks.
   */
  render(state: Readonly<GameState>, lerp?: number, events?: readonly RunEvent[]): RendererFrame;
  resize(): void;
  dispose(): void;
}

export interface RendererFrame {
  deathFinished: boolean;
}

const SPARK_COLOUR = {
  coin: new THREE.Color(0xffd23f),
  crash: new THREE.Color(0xff4d3d),
  dust: new THREE.Color(0xbfae94),
} as const;

const SPARK_CAPACITY = 300;
const SPARK_GRAVITY = -900;

/** A single world-space point cloud for short collection, landing, and crash bursts. */
class Sparks {
  private readonly x = new Float32Array(SPARK_CAPACITY);
  private readonly y = new Float32Array(SPARK_CAPACITY);
  private readonly z = new Float32Array(SPARK_CAPACITY);
  private readonly vx = new Float32Array(SPARK_CAPACITY);
  private readonly vy = new Float32Array(SPARK_CAPACITY);
  private readonly vz = new Float32Array(SPARK_CAPACITY);
  private readonly life = new Float32Array(SPARK_CAPACITY);
  private readonly span = new Float32Array(SPARK_CAPACITY);
  private readonly tint = Array.from({ length: SPARK_CAPACITY }, () => new THREE.Color());
  private count = 0;

  private readonly positions = new Float32Array(SPARK_CAPACITY * 3);
  private readonly colours = new Float32Array(SPARK_CAPACITY * 3);
  readonly points: THREE.Points;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 14,
        sizeAttenuation: true,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  burst(
    at: { x: number; y: number; worldZ: number },
    count: number,
    colour: THREE.Color,
    speed: number,
    seconds: number,
  ): void {
    for (let i = 0; i < count && this.count < SPARK_CAPACITY; i++) {
      const n = this.count++;
      const angle = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI * 0.5;
      const velocity = speed * (0.5 + Math.random() * 0.5);
      this.x[n] = at.x;
      this.y[n] = at.y;
      this.z[n] = at.worldZ;
      this.vx[n] = Math.cos(angle) * Math.cos(pitch) * velocity;
      this.vy[n] = Math.sin(pitch) * velocity;
      this.vz[n] = Math.sin(angle) * Math.cos(pitch) * velocity;
      this.span[n] = seconds * (0.6 + Math.random() * 0.6);
      this.life[n] = this.span[n];
      this.tint[n].copy(colour);
    }
  }

  update(delta: number, cameraZ: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= delta;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }

      this.vy[i] += SPARK_GRAVITY * delta;
      this.x[i] += this.vx[i] * delta;
      this.y[i] += this.vy[i] * delta;
      this.z[i] += this.vz[i] * delta;
      if (this.y[i] < 0) {
        this.y[i] = 0;
        this.vy[i] *= -0.35;
      }

      const fade = this.life[i] / this.span[i];
      this.positions[i * 3] = this.x[i];
      this.positions[i * 3 + 1] = this.y[i];
      this.positions[i * 3 + 2] = -(this.z[i] - cameraZ);
      this.colours[i * 3] = this.tint[i].r * fade;
      this.colours[i * 3 + 1] = this.tint[i].g * fade;
      this.colours[i * 3 + 2] = this.tint[i].b * fade;
    }

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.count);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  private swapRemove(index: number): void {
    const last = --this.count;
    if (index === last) return;
    this.x[index] = this.x[last];
    this.y[index] = this.y[last];
    this.z[index] = this.z[last];
    this.vx[index] = this.vx[last];
    this.vy[index] = this.vy[last];
    this.vz[index] = this.vz[last];
    this.life[index] = this.life[last];
    this.span[index] = this.span[last];
    this.tint[index].copy(this.tint[last]);
  }
}

/** A one-pixel-wide vertical gradient, which three stretches across the viewport. */
function makeSkyGradient(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  const horizon = '#' + SKY.toString(16).padStart(6, '0');
  grad.addColorStop(0, SKY_TOP);
  // Flat from here down, and that is the whole trick. Fog resolves distant
  // geometry to SKY, so anywhere a fogged roofline can appear the sky behind it
  // has to be SKY too — otherwise the roof reads as a white hole punched in the
  // sky. Only the strip above the nearest rooftops gets to be blue.
  grad.addColorStop(0.28, horizon);
  grad.addColorStop(1, horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Scale an object so its largest listed dimension matches the target. */
function fitTo(obj: THREE.Object3D, target: { x?: number; y?: number; z?: number }): void {
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const sx = target.x && size.x ? target.x / size.x : null;
  const sy = target.y && size.y ? target.y / size.y : null;
  const sz = target.z && size.z ? target.z / size.z : null;
  const uniform = sx ?? sy ?? sz ?? 1;
  obj.scale.set(sx ?? uniform, sy ?? uniform, sz ?? uniform);
}

/** Drop an object's feet onto y = 0. */
function groundIt(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
}

/**
 * Wrap a model so its origin sits at the centre of its footprint with its feet
 * on y = 0, which is the point the engine tracks as the obstacle's worldZ.
 *
 * It has to be a wrapper rather than an offset on the model itself: the render
 * loop sets each pooled object's position outright every frame, so any offset
 * living on the object it moves is overwritten — which is how a model whose
 * origin was not its centre came to be drawn half a train away from the box it
 * actually collides with.
 */
function anchored(obj: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.set(-centre.x, -box.min.y, -centre.z);
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  return wrapper;
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    // The source models ship with emissive set to their own albedo, which
    // cancels all lighting. Clear it so the sun actually shapes them.
    if (mat && 'emissive' in mat) {
      mat.emissive = new THREE.Color(0x000000);
      mat.emissiveMap = null;
    }
    if (mat && 'roughness' in mat) {
      mat.roughness = 0.78;
      mat.metalness = 0;
    }
  });
}

/** A reusable set of instances of one model, hidden until claimed each frame. */
class Pool {
  private items: THREE.Object3D[] = [];
  private used = 0;

  constructor(private readonly make: () => THREE.Object3D, private readonly parent: THREE.Object3D) {}

  begin(): void {
    this.used = 0;
  }

  claim(): THREE.Object3D {
    if (this.used === this.items.length) {
      const item = this.make();
      this.items.push(item);
      this.parent.add(item);
    }
    const item = this.items[this.used++];
    item.visible = true;
    return item;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
}

export function createRenderer3D(canvas: HTMLCanvasElement): Renderer3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = makeSkyGradient();
  scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 10, 16000);
  scene.add(camera);

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Bright hemisphere fill keeps the cartoon saturation; the sun does the
  // shaping and casts the shadows. Anything flatter reads as unlit cardboard.
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x9c8b73, 1.15));

  const sun = new THREE.DirectionalLight(0xfff6e6, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1800;
  sun.shadow.camera.left = -520;
  sun.shadow.camera.right = 520;
  sun.shadow.camera.top = 520;
  sun.shadow.camera.bottom = -520;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 2;
  scene.add(sun, sun.target);

  // ── Ground: a long strip with a scrolling railway texture ──────────────────
  const texLoader = new THREE.TextureLoader();
  // Long enough to run from behind the camera to well past FOG_FAR, so the far
  // edge of the strip is never anywhere the eye can reach.
  const GROUND_LEN = 15000;

  // Anisotropy matters more than usual here: the ground now runs for thousands
  // of units, and at grazing angles the sleepers alias into a shimmering mess
  // without it.
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const railTex = texLoader.load('/assets/png/railway_texture.png');
  railTex.colorSpace = THREE.SRGBColorSpace;
  railTex.wrapS = railTex.wrapT = THREE.RepeatWrapping;
  railTex.anisotropy = maxAnisotropy;
  railTex.repeat.set(3, GROUND_LEN / SLEEPER_SPACING);

  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF_W * 2, GROUND_LEN),
    new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.9 })
  );
  track.rotation.x = -Math.PI / 2;
  track.receiveShadow = true;
  scene.add(track);

  const stoneTex = texLoader.load('/assets/png/stone.png');
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.anisotropy = maxAnisotropy;
  stoneTex.repeat.set(24, GROUND_LEN / 140);

  // Tinted down: at full brightness the cobbles out-shouted the track they are
  // supposed to frame, and the lane the runner is in has to read first.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, GROUND_LEN),
    new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x8e949c, roughness: 0.95 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -2;
  apron.receiveShadow = true;
  scene.add(apron);

  // ── Loaded models ──────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  const pools: Partial<Record<'train' | 'low' | 'bar' | 'coin' | 'turnLeft' | 'turnRight', Pool>> = {};
  const houses: { obj: THREE.Object3D; side: 1 | -1; slot: number }[] = [];

  const runner = new THREE.Group();
  scene.add(runner);
  let runnerReady = false;
  let runnerLoadFailed = false;
  let mixer: THREE.AnimationMixer | null = null;
  let clips: Record<string, THREE.AnimationAction> = {};
  let currentClip = '';

  const sparks = new Sparks();
  scene.add(sparks.points);

  const arrowTextures: THREE.CanvasTexture[] = [];

  function turnSign(direction: 'left' | 'right'): THREE.Mesh {
    const sign = document.createElement('canvas');
    sign.width = 256;
    sign.height = 128;
    const context = sign.getContext('2d')!;
    context.fillStyle = '#082d27';
    context.fillRect(0, 0, sign.width, sign.height);
    context.strokeStyle = '#5dffcf';
    context.lineWidth = 10;
    context.strokeRect(5, 5, sign.width - 10, sign.height - 10);
    context.fillStyle = '#5dffcf';
    context.font = 'bold 96px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(direction === 'left' ? '←' : '→', 128, 66);

    const texture = new THREE.CanvasTexture(sign);
    texture.colorSpace = THREE.SRGBColorSpace;
    arrowTextures.push(texture);
    return new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF_W * 1.15, 130),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
  }

  const load = (name: string) =>
    loader.loadAsync(GLB(name)).then(gltf => {
      enableShadows(gltf.scene);
      return gltf;
    });

  // Obstacles. Each model is scaled to the box the engine collides against and
  // anchored on that box's centre, so what you see is what collides.
  load('train').then(({ scene: model }) => {
    fitTo(model, { x: LANE_W * 0.92, y: WALL_HEIGHT, z: OBSTACLE_DEPTH.WALL });
    pools.train = new Pool(() => anchored(model.clone(true)), scene);
  });

  load('kerb_stone').then(({ scene: model }) => {
    fitTo(model, { x: LANE_W * 0.9, y: LOW_WALL_HEIGHT, z: OBSTACLE_DEPTH.LOW_WALL });
    pools.low = new Pool(() => anchored(model.clone(true)), scene);
  });

  load('hurdle').then(({ scene: model }) => {
    fitTo(model, {
      x: LANE_W * 0.95,
      y: HIGH_BAR_BOTTOM + HIGH_BAR_THICKNESS,
      z: OBSTACLE_DEPTH.HIGH_BAR,
    });
    pools.bar = new Pool(() => anchored(model.clone(true)), scene);
  });

  load('roadblock1').then(({ scene: model }) => {
    fitTo(model, { x: TRACK_HALF_W * 2, y: WALL_HEIGHT * 0.9, z: 120 });
    const makeGate = (direction: 'left' | 'right') => {
      const gate = anchored(model.clone(true));
      const sign = turnSign(direction);
      sign.position.set(0, WALL_HEIGHT * 0.82, TURN_SIGN_Z);
      gate.add(sign);
      return gate;
    };
    pools.turnLeft = new Pool(() => makeGate('left'), scene);
    pools.turnRight = new Pool(() => makeGate('right'), scene);
  });

  load('coin').then(({ scene: model }) => {
    fitTo(model, { x: 36, y: 36, z: 8 });
    // Coins are the one thing that should read as gold from any angle, and the
    // gold lives in the texture — so the glow has to come through emissiveMap.
    model.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = 0.35;
    });
    pools.coin = new Pool(() => model.clone(true), scene);
  });

  // Scenery: two rows of houses recycled along the track as the camera moves.
  Promise.all(['house1', 'house2', 'house3', 'house4', 'house5'].map(load)).then(models => {
    models.forEach(({ scene: model }, i) => {
      // Height sets the scale, but the models vary wildly in footprint, so cap
      // the width too — otherwise a wide one swallows the whole track.
      fitTo(model, { y: HOUSE_HEIGHT });
      const spread = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (spread.x > HOUSE_MAX_WIDTH) {
        const k = HOUSE_MAX_WIDTH / spread.x;
        model.scale.multiplyScalar(k);
        spread.multiplyScalar(k);
      }
      // Stand each row just clear of the track edge, facing the runner.
      const offsetX = TRACK_HALF_W + HOUSE_SETBACK + spread.x / 2;
      for (const side of [1, -1] as const) {
        for (let s = i; s < HOUSE_SLOTS; s += models.length) {
          const obj = model.clone(true);
          groundIt(obj);
          obj.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
          obj.position.x = side * offsetX;
          scene.add(obj);
          houses.push({ obj, side, slot: s });
        }
      }
    });
  });

  // The runner, with action clips trimmed to the movement they depict.
  load('player1').then(gltf => {
    const model = gltf.scene;
    fitTo(model, { y: PLAYER_WORLD_HEIGHT });
    groundIt(model);
    model.rotation.y = Math.PI;  // face away from the camera, down the track
    runner.add(model);
    runnerReady = true;

    mixer = new THREE.AnimationMixer(model);
    clips = {};
    for (const clip of gltf.animations) {
      const trim = CLIP_TRIM[clip.name];
      const used = trim
        ? THREE.AnimationUtils.subclip(clip, clip.name, trim[0], trim[1], SOURCE_FPS)
        : clip;
      const action = mixer.clipAction(used);
      if (trim) {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }
      clips[clip.name] = action;
    }
  }).catch(() => {
    runnerLoadFailed = true;
  });

  /** Cross-fade the runner into the clip for an engine action. */
  function playClip(name: string, fade: number): void {
    if (!clips[name] || currentClip === name) return;
    if (currentClip && clips[currentClip]) clips[currentClip].fadeOut(fade);
    clips[name].reset().fadeIn(fade).play();
    currentClip = name;
  }

  const CLIP_FOR: Record<string, string> = {
    running: 'run',
    jumping: 'jump',
    sliding: 'roll',
  };

  function holdAtProgress(action: THREE.AnimationAction, progress: number): void {
    action.paused = true;
    action.time = clamp(progress, 0, 1) * action.getClip().duration;
  }

  function resize(): void {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    camera.fov = aspect > CAM_BASE_ASPECT
      ? THREE.MathUtils.radToDeg(
          2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAM_FOV) / 2) * CAM_BASE_ASPECT / aspect))
      : CAM_FOV;
    camera.updateProjectionMatrix();
  }
  resize();

  let lastFrame = performance.now();
  let sinceImpact: number | null = null;
  let sinceLanding = Infinity;
  let wasAirborne = false;
  let deathElapsed: number | null = null;
  let previousStatus: GameState['status'] | null = null;

  function render(
    state: Readonly<GameState>,
    step = 0,
    events: readonly RunEvent[] = [],
  ): RendererFrame {
    const now = performance.now();
    const delta = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    const { player } = state;
    // Everything in the world is drawn relative to this, so advancing it by the
    // unspent fraction of a step slides the whole corridor smoothly at once.
    const cameraZ = state.cameraZ + step * state.speed;

    // Lateral position: the engine already tracks the lane-change progress.
    const from = LANE_WORLD_X[player.lane];
    const to = LANE_WORLD_X[player.targetLane];
    const laneT = clamp(player.laneT + step / LANE_CHANGE_FRAMES, 0, 1);
    const px = lerp(from, to, smoothstep(laneT));

    if (state.status === 'playing' && previousStatus !== 'playing') {
      sinceLanding = Infinity;
      wasAirborne = false;
      deathElapsed = null;
    }

    if (state.status === 'gameover' && runnerReady) {
      deathElapsed = deathElapsed === null ? 0 : deathElapsed + delta;
    } else if (state.status !== 'gameover') {
      deathElapsed = null;
    }

    if (state.status === 'playing') sinceImpact = null;
    for (const event of events) {
      if (event.kind === 'coin') {
        sparks.burst(
          { x: LANE_WORLD_X[event.lane], y: 86, worldZ: event.worldZ },
          12,
          SPARK_COLOUR.coin,
          260,
          0.5,
        );
      } else {
        sinceImpact = 0;
        sparks.burst(
          {
            x: LANE_WORLD_X[event.lane],
            y: PLAYER_WORLD_HEIGHT * 0.55,
            worldZ: state.cameraZ + PLAYER_Z,
          },
          26,
          SPARK_COLOUR.crash,
          420,
          0.7,
        );
      }
    }
    if (sinceImpact !== null && state.status !== 'playing') sinceImpact += delta;

    const airborne = player.action === 'jumping';
    if (wasAirborne && !airborne && state.status === 'playing') {
      sinceLanding = 0;
      sparks.burst(
        { x: px, y: 6, worldZ: cameraZ + PLAYER_Z },
        10,
        SPARK_COLOUR.dust,
        150,
        0.35,
      );
    }
    wasAirborne = airborne;
    sinceLanding += delta;

    // ── Runner ───────────────────────────────────────────────────────────────
    if (runnerReady) {
      runner.position.set(px, player.worldY, -PLAYER_Z);
      const dying = state.status === 'gameover';
      const clipName = dying ? 'die' : CLIP_FOR[player.action] ?? 'run';
      playClip(clipName, clipName === 'run' ? FADE_RUN : FADE_ACTION);

      const action = clips[clipName];
      if (action) {
        if (clipName === 'jump' || clipName === 'roll') {
          holdAtProgress(action, player.actionT + step / player.actionDuration);
        } else if (clipName === 'run') {
          action.timeScale = (state.speed / INITIAL_SPEED) ** CADENCE_EXPONENT;
        }
      }

      const laneDirection = Math.sign(to - from);
      runner.rotation.z = dying
        ? 0
        : -laneDirection * Math.sin(laneT * Math.PI) * LEAN_RADIANS;

      const squash = Math.max(0, 1 - sinceLanding / LAND_SECONDS);
      const spread = 1 + LAND_SQUASH * squash * 0.5;
      runner.scale.set(spread, 1 - LAND_SQUASH * squash, spread);
    }
    mixer?.update(delta);
    sparks.update(delta, cameraZ);

    // ── Camera and sun follow the runner ─────────────────────────────────────
    const settle = sinceImpact === null
      ? 0
      : smoothstep(clamp(sinceImpact / SETTLE_SECONDS, 0, 1));
    const shake = sinceImpact === null
      ? 0
      : Math.max(0, 1 - sinceImpact / SHAKE_SECONDS) ** 2;
    const jolt = () => (Math.random() - 0.5) * SHAKE_UNITS * shake;

    const camX = px * CAM_LATERAL_FOLLOW;
    camera.position.set(
      camX + jolt(),
      lerp(CAM_HEIGHT, CAM_HEIGHT * 0.78, settle) + jolt(),
      -PLAYER_Z + lerp(CAM_BACK, CAM_BACK * 0.72, settle),
    );
    camera.lookAt(
      camX,
      lerp(CAM_LOOK_HEIGHT, PLAYER_WORLD_HEIGHT * 0.4, settle),
      -PLAYER_Z - lerp(CAM_LOOK_AHEAD, 60, settle),
    );

    sun.position.set(px + 400, 900, -PLAYER_Z + 500);
    sun.target.position.set(px, 0, -PLAYER_Z - 400);
    sun.target.updateMatrixWorld();

    // ── Ground scroll ────────────────────────────────────────────────────────
    // Keep the strip centred ahead of the camera and move the texture instead.
    track.position.z = -PLAYER_Z - GROUND_LEN / 2 + 900;  // near edge just behind the camera
    apron.position.z = track.position.z;
    railTex.offset.y = -(cameraZ % SLEEPER_SPACING) / SLEEPER_SPACING;
    stoneTex.offset.y = -(cameraZ % 140) / 140;

    // ── Scenery recycling ────────────────────────────────────────────────────
    // Each slot wraps once it passes the camera; the wrap happens beyond the
    // fog, so it is never visible.
    const span = HOUSE_SLOTS * HOUSE_SPACING;
    for (const h of houses) {
      const relZ = (((h.slot * HOUSE_SPACING - cameraZ) % span) + span) % span;
      h.obj.position.z = -(relZ + HOUSE_NEAR);
    }

    // ── Obstacles ────────────────────────────────────────────────────────────
    for (const pool of Object.values(pools)) pool?.begin();

    const place = (pool: Pool | undefined, lane: Lane, relZ: number, y = 0) => {
      if (!pool) return;
      const o = pool.claim();
      o.position.set(LANE_WORLD_X[lane], y, -relZ);
    };

    for (const obs of state.obstacles as readonly Obstacle[]) {
      const relZ = obs.worldZ - cameraZ;
      if (relZ < NEAR_Z - 400 || relZ > FAR_Z) continue;

      if (obs.type === 'TURN_LEFT' || obs.type === 'TURN_RIGHT') {
        const pool = obs.type === 'TURN_LEFT' ? pools.turnLeft : pools.turnRight;
        const o = pool?.claim();
        if (o) o.position.set(0, 0, -relZ);
        continue;
      }

      const lanes: Lane[] = obs.lane === -1 ? [0, 1, 2] : [obs.lane];
      for (const lane of lanes) {
        if (obs.type === 'WALL') place(pools.train, lane, relZ);
        else if (obs.type === 'LOW_WALL') place(pools.low, lane, relZ);
        else if (obs.type === 'HIGH_BAR') place(pools.bar, lane, relZ);
      }
    }

    // ── Coins ────────────────────────────────────────────────────────────────
    for (const coin of state.coinItems) {
      if (coin.collected) continue;
      const relZ = coin.worldZ - cameraZ;
      if (relZ < NEAR_Z - 200 || relZ > FAR_Z) continue;
      const o = pools.coin?.claim();
      if (o) {
        o.position.set(LANE_WORLD_X[coin.lane], 86, -relZ);
        o.rotation.y += delta * 3;
      }
    }

    for (const pool of Object.values(pools)) pool?.end();

    const turn = state.turnWarning;
    if (turn) {
      const relZ = turn.worldZ - cameraZ;
      if (relZ >= NEAR_Z - 400 && relZ <= FAR_Z) {
        const pool = turn.direction === 'left' ? pools.turnLeft : pools.turnRight;
        const gate = pool?.claim();
        if (gate) gate.position.set(0, 0, -relZ);
      }
    }

    renderer.render(scene, camera);
    previousStatus = state.status;
    return {
      deathFinished: state.status === 'gameover'
        && deathAnimationComplete(runnerReady, runnerLoadFailed, deathElapsed ?? 0),
    };
  }

  function dispose(): void {
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose();
    });
    railTex.dispose();
    stoneTex.dispose();
    for (const texture of arrowTextures) texture.dispose();
    sparks.points.geometry.dispose();
    (sparks.points.material as THREE.Material).dispose();
    renderer.dispose();
  }

  return { render, resize, dispose };
}
