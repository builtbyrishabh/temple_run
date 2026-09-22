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
import { createWorld, enableShadows } from './three/world';
import type { GameState, Lane, RunEvent } from '../../types/game';

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

// ── Runner animation ─────────────────────────────────────────────────────────
//
// None of the imported clips is the length of the action it illustrates. `jump`
// is a 1.93s run-jump-run take around a jump the engine gives 34 frames (0.57s);
// `roll` is a 1.83s tumble around a 30-frame (0.5s) slide. Played whole, the
// clip is still crouching to take off when the runner has already landed.
//
// So each is trimmed to the part that *is* the action. The ranges below were
// measured off the clips themselves — the frames between the runner's feet
// leaving the ground and touching it again for `jump`, and the frames its hips
// spend below standing height for `roll` — rather than guessed:
//
//   jump  f17–f34  the leap between the two running strides, 0.567s, which is
//                  34 frames at 60fps: the engine's jump window exactly
//   roll  f10–f40  down into the tumble and back up, 1.0s, played at 2× to fit
//                  the 0.5s slide
//   die   f10–f44  the stagger and the fall, minus the lying still afterwards
export const SOURCE_FPS = 30;
export const CLIP_TRIM: Record<string, readonly [number, number]> = {
  jump: [17, 34],
  roll: [10, 40],
  die:  [10, 44],
};

/** How long the death clip runs, and so how long an impact needs before results. */
export const DEATH_SECONDS = (CLIP_TRIM.die[1] - CLIP_TRIM.die[0]) / SOURCE_FPS;

/**
 * Stride frequency against corridor speed. Cadence grows far more slowly than
 * speed does — a runner going twice as fast does not take twice as many steps,
 * it takes longer ones — so tying the clip to speed 1:1 makes the legs scrabble
 * without the runner looking any faster. The exponent keeps the feet looking
 * planted from INITIAL_SPEED all the way to MAX_SPEED.
 */
const CADENCE_EXPONENT = 0.35;

/** Cross-fades: long enough to blend, short enough not to eat a 0.5s action. */
const FADE_RUN = 0.12;
const FADE_ACTION = 0.06;

/** How far the runner banks into a lane change, in radians at the midpoint. */
const LEAN_RADIANS = 0.30;

/** Squash on landing, and how long it takes to spring back. */
const LAND_SQUASH = 0.14;
const LAND_SECONDS = 0.22;

// ── Impact ───────────────────────────────────────────────────────────────────
/** Camera shake at the moment of contact, and how quickly it dies away. */
const SHAKE_UNITS = 22;
const SHAKE_SECONDS = 0.35;
/** The camera closes in on the wreck over this long, so the last frame is read. */
const SETTLE_SECONDS = 0.9;

const GLB = (name: string) => `/assets/glb/${name}.glb`;

export interface Renderer3D {
  /**
   * Draw one frame of the given state. Safe to call before assets finish
   * loading. `lerp` is the fraction of a simulation step already owed but not
   * yet taken — the caller runs a fixed 60Hz step, so on a faster display this
   * is what keeps the corridor sliding instead of advancing in visible jerks.
   *
   * `events` are whatever the engine reported during the steps taken since the
   * last frame. They are the only way effects get here: the engine says a coin
   * was taken, this decides what that looks like.
   */
  render(
    state: Readonly<GameState>,
    lerp?: number,
    events?: readonly RunEvent[],
    presentationPaused?: boolean,
  ): void;
  resize(): void;
  dispose(): void;
}

// ── Sparks ───────────────────────────────────────────────────────────────────

/** Colours, so a pickup, a landing and a crash are told apart at a glance. */
const SPARK_COLOUR = {
  coin:  new THREE.Color(0xffd23f),
  crash: new THREE.Color(0xff4d3d),
  dust:  new THREE.Color(0xbfae94),
} as const;

const SPARK_CAPACITY = 300;
const SPARK_GRAVITY = -900;   // world units per second squared

/**
 * Short-lived world-space sparks, drawn as one additive point cloud.
 *
 * Held in absolute world-Z like every other object, so a burst stays where it
 * happened while the corridor keeps sliding past it. Dead particles are
 * swap-removed and the draw range trimmed, so an empty field costs one draw
 * call of nothing rather than a buffer full of hidden points.
 */
class Sparks {
  private readonly x = new Float32Array(SPARK_CAPACITY);
  private readonly y = new Float32Array(SPARK_CAPACITY);
  private readonly z = new Float32Array(SPARK_CAPACITY);   // absolute world-Z
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
        // Additive, so fading a spark is just fading its colour to black — one
        // attribute instead of a per-point alpha the material cannot take.
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** Throw `count` sparks out of one point, in world coordinates. */
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
      const v = speed * (0.5 + Math.random() * 0.5);
      this.x[n] = at.x;
      this.y[n] = at.y;
      this.z[n] = at.worldZ;
      this.vx[n] = Math.cos(angle) * Math.cos(pitch) * v;
      this.vy[n] = Math.sin(pitch) * v;
      this.vz[n] = Math.sin(angle) * Math.cos(pitch) * v;
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
      if (this.y[i] < 0) { this.y[i] = 0; this.vy[i] *= -0.35; }

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

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.life[i] = this.life[last]; this.span[i] = this.span[last];
    this.tint[i].copy(this.tint[last]);
  }
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
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 10, 16000);
  scene.add(camera);

  const world = createWorld(scene, renderer);
  const { sun } = world;

  // ── Loaded models ──────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  const pools: Partial<Record<'train' | 'low' | 'bar' | 'coin', Pool>> = {};

  // The model carries its own facing rotation; the group is what the render
  // loop leans and squashes, so those stay in world space and cannot fight it.
  const runner = new THREE.Group();
  scene.add(runner);
  let runnerReady = false;
  let mixer: THREE.AnimationMixer | null = null;
  let clips: Record<string, THREE.AnimationAction> = {};
  let currentClip = '';

  const sparks = new Sparks();
  scene.add(sparks.points);

  const load = (name: string) =>
    loader.loadAsync(GLB(name)).then(gltf => {
      enableShadows(gltf.scene);
      return gltf;
    });

  // Obstacles. Each model is scaled to the box the engine collides against and
  // anchored on that box's centre, so what you see is what collides.
  load('train').then(({ scene: model }) => {
    fitTo(model, { x: LANE_W * 0.92, y: WALL_HEIGHT, z: OBSTACLE_DEPTH.WALL });
    // The asset's rear is open. Face its closed cab toward the approaching
    // runner, then anchor the rotated footprint to the collision box.
    model.rotation.y = Math.PI;
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

  load('coin').then(({ scene: model }) => {
    fitTo(model, { x: 28, y: 28, z: 7 });
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

  // The runner, with the clip names the engine's actions map onto.
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

  /**
   * Hold an action's clip at the point the engine has actually reached.
   *
   * The alternative is to let the mixer run the clip on its own clock and hope
   * the two agree. They do not have to: the simulation steps a fixed 60Hz and
   * catches up after a stall, while the mixer advances by whatever wall-clock
   * the last frame took. Driving the phase from `actionT` means take-off, apex
   * and landing land on the frames the engine says they do, and the hitbox and
   * the pose can never disagree about whether the runner is in the air.
   */
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
  /** Seconds since contact, or null while the run is still going. */
  let sinceImpact: number | null = null;
  /** Seconds since the runner last touched down out of a jump. */
  let sinceLanding = Infinity;
  let wasAirborne = false;
  const impactJolt = new THREE.Vector2();

  function render(
    state: Readonly<GameState>,
    step = 0,
    events: readonly RunEvent[] = [],
    presentationPaused = false,
  ): void {
    const now = performance.now();
    const delta = presentationPaused ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
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

    // ── Effects the engine asked for ─────────────────────────────────────────
    // The renderer outlives a run now, so the impact has to be let go of when
    // the next one starts — a live run is by definition not in one. This has to
    // come before the events below: the crash arrives on the same frame the
    // status flips, and it is what starts the clock.
    if (state.status === 'playing') sinceImpact = null;

    for (const event of events) {
      if (event.kind === 'coin') {
        sparks.burst(
          { x: LANE_WORLD_X[event.lane], y: 86, worldZ: event.worldZ },
          12, SPARK_COLOUR.coin, 260, 0.5,
        );
      } else {
        sinceImpact = 0;
        sparks.burst(
          { x: LANE_WORLD_X[event.lane], y: PLAYER_WORLD_HEIGHT * 0.55, worldZ: state.cameraZ + PLAYER_Z },
          26, SPARK_COLOUR.crash, 420, 0.7,
        );
      }
    }
    if (sinceImpact !== null && state.status !== 'playing') sinceImpact += delta;

    // A landing is the one beat the clips do not sell on their own: the trimmed
    // jump ends the instant the feet are down, so the weight arriving is this.
    const airborne = player.action === 'jumping';
    if (wasAirborne && !airborne && state.status === 'playing') {
      sinceLanding = 0;
      sparks.burst({ x: px, y: 6, worldZ: cameraZ + PLAYER_Z }, 10, SPARK_COLOUR.dust, 150, 0.35);
    }
    wasAirborne = airborne;
    sinceLanding += delta;

    // ── Runner ───────────────────────────────────────────────────────────────
    if (runnerReady) {
      runner.position.set(px, player.worldY, -PLAYER_Z);

      const dying = state.status === 'gameover';
      const clipName = dying ? 'die' : CLIP_FOR[player.action] ?? 'run';
      playClip(clipName, clipName === 'run' ? FADE_RUN : FADE_ACTION);

      const acting = clips[clipName];
      if (acting) {
        if (clipName === 'jump' || clipName === 'roll') {
          holdAtProgress(acting, player.actionT + step / player.actionDuration);
        } else if (clipName === 'run') {
          acting.timeScale = (state.speed / INITIAL_SPEED) ** CADENCE_EXPONENT;
        }
      }

      // Bank into a lane change, peaking halfway across and gone on arrival.
      // Taken from the engine's own transition progress rather than from a
      // frame-to-frame delta, so it does not vary with the display's refresh.
      const laneDir = Math.sign(to - from);
      runner.rotation.z = dying ? 0 : -laneDir * Math.sin(laneT * Math.PI) * LEAN_RADIANS;

      const squash = Math.max(0, 1 - sinceLanding / LAND_SECONDS);
      const spread = 1 + LAND_SQUASH * squash * 0.5;
      runner.scale.set(spread, 1 - LAND_SQUASH * squash, spread);
    }
    mixer?.update(delta);
    sparks.update(delta, cameraZ);

    // ── Camera and sun follow the runner ─────────────────────────────────────
    // On impact the camera jolts once and then closes in on the wreck, so the
    // crash is seen rather than cut away from. Both are bounded: a shake that
    // outlasts the hit, or a push-in that keeps going, reads as a broken camera.
    const settle = sinceImpact === null ? 0 : smoothstep(clamp(sinceImpact / SETTLE_SECONDS, 0, 1));
    const shake = sinceImpact === null ? 0 : Math.max(0, 1 - sinceImpact / SHAKE_SECONDS) ** 2;
    if (!presentationPaused) {
      impactJolt.set(
        (Math.random() - 0.5) * SHAKE_UNITS * shake,
        (Math.random() - 0.5) * SHAKE_UNITS * shake,
      );
    }
    const camX = px * CAM_LATERAL_FOLLOW;
    camera.position.set(
      camX + impactJolt.x,
      lerp(CAM_HEIGHT, CAM_HEIGHT * 0.78, settle) + impactJolt.y,
      -PLAYER_Z + lerp(CAM_BACK, CAM_BACK * 0.72, settle),
    );
    camera.lookAt(
      camX,
      lerp(CAM_LOOK_HEIGHT, PLAYER_WORLD_HEIGHT * 0.4, settle),
      -PLAYER_Z - lerp(CAM_LOOK_AHEAD, 60, settle),
    );
    sun.position.set(px - 650, 750, -PLAYER_Z + 350);
    sun.target.position.set(px, 0, -PLAYER_Z - 400);
    sun.target.updateMatrixWorld();

    world.update(cameraZ);

    // ── Obstacles ────────────────────────────────────────────────────────────
    for (const pool of Object.values(pools)) pool?.begin();

    const place = (pool: Pool | undefined, lane: Lane, relZ: number, y = 0) => {
      if (!pool) return;
      const o = pool.claim();
      o.position.set(LANE_WORLD_X[lane], y, -relZ);
    };

    for (const obs of state.obstacles) {
      const relZ = obs.worldZ - cameraZ;
      if (relZ < NEAR_Z - 400 || relZ > FAR_Z) continue;

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

    renderer.render(scene, camera);
  }

  function dispose(): void {
    world.dispose();
    sparks.points.geometry.dispose();
    (sparks.points.material as THREE.Material).dispose();
    renderer.dispose();
  }

  return { render, resize, dispose };
}
