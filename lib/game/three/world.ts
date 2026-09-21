// ─────────────────────────────────────────────────────────────────────────────
// lib/game/three/world.ts  –  The corridor the runner runs down
//
// Everything here is scenery: sky, ballast, rails, sleepers, kerbs, lamp posts
// and houses. None of it reads `GameState` — it only ever needs to know how far
// the camera has travelled, so that the pieces recycle behind the fog.
//
// The rails are real geometry rather than a texture on a plane. That is the
// single biggest reason this reads as a railway rather than as wallpaper: a
// photographed track laid flat has no silhouette, so it never catches the sun
// and never passes anything. Steel that stands 20 units proud of the ballast
// does both.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LANE_WORLD_X, TRACK_HALF_W } from '../../constants';
import { recycledRowZ, trackTravelOffset } from './motion';

// ── Depth ────────────────────────────────────────────────────────────────────
/** Horizon colour. Fog resolves to this, so distance fades into the skyline. */
export const SKY = 0xbcd8f2;
// Fog has to finish before FAR_Z, because that is where obstacles are culled and
// a train must not appear out of clear air. Just as important is that the range
// be *long*: squeezed into a few hundred units it compresses into a handful of
// pixels and reads as a white wall across the track.
const FOG_NEAR = 2600;
const FOG_FAR = 7200;
/** Long enough to run from behind the camera to past the fog, both ways. */
const GROUND_LEN = 18000;

// ── Track ────────────────────────────────────────────────────────────────────
// The running surface is the top of the rails, at y = 0, because that is where
// the engine grounds the player and every obstacle. Ballast and sleepers are
// sunk below it.
const RAIL_TOP = 0;
const RAIL_H = 13;
const RAIL_W = 6;
/** Distance between the two rails of one lane's track. */
const RAIL_GAUGE = 64;
const SLEEPER_W = 70;
const SLEEPER_H = 9;
const SLEEPER_D = 20;
const SLEEPER_SPACING = 62;
const BALLAST_Y = RAIL_TOP - RAIL_H - SLEEPER_H;
/** Ballast runs a little wider than the lanes so the track has a shoulder. */
const BALLAST_HALF_W = TRACK_HALF_W + 46;

// ── Sides ────────────────────────────────────────────────────────────────────
const KERB_H = 42;
const LAMP_SPACING = 700;
const LAMP_SLOTS = 11;
const LAMP_HEIGHT = 250;
/** Gap between the ballast shoulder and the near face of a house row. */
const HOUSE_SETBACK = 390;
const HOUSE_SPACING = 700;
const HOUSE_SLOTS = 10;
const HOUSE_HEIGHT = 360;
const HOUSE_MAX_WIDTH = 360;
const HOUSE_NEAR = 220;
const TEXTURE_TILE = 180;

const GLB = (name: string) => `/assets/glb/${name}.glb`;

export interface World {
  /** Reposition every recycled row for a camera that has travelled `cameraZ`. */
  update(cameraZ: number): void;
  /** Aim the sun at the runner so shadows stay inside the shadow frustum. */
  sun: THREE.DirectionalLight;
  dispose(): void;
}

/**
 * A sky dome rather than a flat background texture. The difference only shows
 * when the camera pans on a lane change — a background bitmap is pinned to the
 * viewport and slides with nothing, while a dome parallaxes like sky.
 */
function makeSky(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#2f7fd4');
  grad.addColorStop(0.34, '#79b4e8');
  // Flat from here down, and that is the whole trick. Fog resolves distant
  // geometry to SKY, so anywhere a fogged roofline can appear the sky behind it
  // has to be SKY too — otherwise the roof reads as a hole punched in the sky.
  grad.addColorStop(0.52, '#' + SKY.toString(16).padStart(6, '0'));
  grad.addColorStop(1.0, '#' + SKY.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // Soft cumulus, drawn as clusters of blurred discs and kept in the upper
  // third so they never collide with the fogged horizon band.
  ctx.globalAlpha = 0.85;
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * 1024;
    const cy = 40 + Math.random() * 150;
    const scale = 0.5 + Math.random();
    for (let p = 0; p < 6; p++) {
      const r = (18 + Math.random() * 26) * scale;
      ctx.beginPath();
      ctx.ellipse(cx + (Math.random() - 0.5) * 90 * scale, cy + (Math.random() - 0.5) * 22 * scale,
        r * 1.5, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(13000, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  );
}

/** A small, deterministic texture keeps the ground quiet and avoids asset noise. */
function makeGroundTexture(base: string, fleck: string, density: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  let seed = 0x51f15e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < density; i++) {
    const tone = 0.25 + random() * 0.35;
    ctx.globalAlpha = tone;
    ctx.fillStyle = fleck;
    const r = 0.7 + random() * 1.5;
    ctx.beginPath();
    ctx.ellipse(random() * size, random() * size, r, r * (0.55 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
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
 * Strip the self-illumination the source models ship with. They set emissive to
 * their own albedo, which cancels all lighting and leaves them looking like
 * unlit cardboard no matter how the sun is placed.
 */
export function enableShadows(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && 'emissive' in mat) {
      mat.emissive = new THREE.Color(0x000000);
      mat.emissiveMap = null;
    }
    if (mat && 'roughness' in mat) {
      mat.roughness = 0.72;
      mat.metalness = 0;
    }
  });
}

/** One lamp post: pole, arm and a warm head that the bloom pass picks up. */
function makeLamp(): THREE.Object3D {
  const lamp = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3d4550, roughness: 0.5, metalness: 0.7 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, LAMP_HEIGHT, 8), metal);
  pole.position.y = LAMP_HEIGHT / 2;
  pole.castShadow = true;

  const arm = new THREE.Mesh(new THREE.BoxGeometry(42, 5, 5), metal);
  arm.position.set(-18, LAMP_HEIGHT - 6, 0);
  arm.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(24, 10, 14),
    new THREE.MeshStandardMaterial({
      color: 0xe6aa55, emissive: 0xc97824, emissiveIntensity: 0.55, roughness: 0.48,
    })
  );
  head.position.set(-36, LAMP_HEIGHT - 12, 0);

  lamp.add(pole, arm, head);
  return lamp;
}

export function createWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): World {
  scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);

  const sky = makeSky();
  scene.add(sky);

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Bright hemisphere fill keeps the cartoon saturation; the sun does the
  // shaping and casts the shadows. Anything flatter reads as unlit cardboard.
  scene.add(new THREE.HemisphereLight(0xd9edff, 0x7b796b, 1.2));

  const sun = new THREE.DirectionalLight(0xfff4df, 2.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 2400;
  // Tight enough that 2048 pixels land on the stretch the player can actually
  // see. Widening this is the quickest way to make every shadow mush.
  sun.shadow.camera.left = -420;
  sun.shadow.camera.right = 420;
  sun.shadow.camera.top = 420;
  sun.shadow.camera.bottom = -420;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 2;
  scene.add(sun, sun.target);

  const disposables: { dispose(): void }[] = [];
  const track = new THREE.Group();     // scrolls with the camera, modulo one sleeper
  scene.add(track);

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  // ── Ballast and verge ──────────────────────────────────────────────────────
  const ballastTex = makeGroundTexture('#7d8387', '#c1c5c5', 1250);
  ballastTex.anisotropy = maxAnisotropy;
  ballastTex.repeat.set(BALLAST_HALF_W * 2 / TEXTURE_TILE, GROUND_LEN / TEXTURE_TILE);
  disposables.push(ballastTex);
  const ballast = new THREE.Mesh(
    new THREE.PlaneGeometry(BALLAST_HALF_W * 2, GROUND_LEN),
    new THREE.MeshStandardMaterial({ map: ballastTex, color: 0xb7bdc0, roughness: 1 })
  );
  ballast.rotation.x = -Math.PI / 2;
  ballast.position.y = BALLAST_Y;
  ballast.receiveShadow = true;
  scene.add(ballast);

  const vergeTex = makeGroundTexture('#708166', '#a5b092', 700);
  vergeTex.anisotropy = maxAnisotropy;
  vergeTex.repeat.set(3200 / TEXTURE_TILE, GROUND_LEN / TEXTURE_TILE);
  disposables.push(vergeTex);
  const verge = new THREE.Mesh(
    new THREE.PlaneGeometry(3200, GROUND_LEN),
    new THREE.MeshStandardMaterial({ map: vergeTex, color: 0x9eaa91, roughness: 1 })
  );
  verge.rotation.x = -Math.PI / 2;
  verge.position.y = BALLAST_Y - 26;
  verge.receiveShadow = true;
  scene.add(verge);

  // ── Rails ──────────────────────────────────────────────────────────────────
  // Uniform along Z, so unlike the sleepers they never need recycling.
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb4bac1, roughness: 0.38, metalness: 0.82 });
  const railGeo = new THREE.BoxGeometry(RAIL_W, RAIL_H, GROUND_LEN);
  for (const laneX of LANE_WORLD_X) {
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(laneX + side * RAIL_GAUGE / 2, RAIL_TOP - RAIL_H / 2, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      scene.add(rail);
    }
  }

  // ── Sleepers ───────────────────────────────────────────────────────────────
  // One instanced mesh for all three lanes. The whole row is shifted by less
  // than one spacing each frame, so the instances themselves never move.
  const sleeperCount = Math.ceil(GROUND_LEN / SLEEPER_SPACING);
  const sleepers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(SLEEPER_W, SLEEPER_H, SLEEPER_D),
    new THREE.MeshStandardMaterial({ color: 0x665444, roughness: 0.96 }),
    sleeperCount * LANE_WORLD_X.length
  );
  sleepers.castShadow = true;
  sleepers.receiveShadow = true;
  {
    const m = new THREE.Matrix4();
    const colour = new THREE.Color();
    let i = 0;
    for (let s = 0; s < sleeperCount; s++) {
      // Laid from just behind the camera plane forward into the fog.
      const z = 600 - s * SLEEPER_SPACING;
      for (const laneX of LANE_WORLD_X) {
        m.makeTranslation(laneX, RAIL_TOP - RAIL_H - SLEEPER_H / 2, z);
        sleepers.setMatrixAt(i, m);
        // A little grain, so a hundred identical timbers do not read as a comb.
        const k = 0.88 + Math.random() * 0.18;
        sleepers.setColorAt(i, colour.setRGB(k, k * 0.96, k * 0.9));
        i++;
      }
    }
  }
  track.add(sleepers);

  // Light maintenance walks give the railway a clean edge against the verge.
  const walkMat = new THREE.MeshStandardMaterial({ color: 0xbec1b9, roughness: 0.94 });
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(82, GROUND_LEN), walkMat);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(side * (BALLAST_HALF_W + 58), BALLAST_Y - 18, 0);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // ── Kerbs: a hard edge where the track stops ───────────────────────────────
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xc8cbc4, roughness: 0.92 });
  const kerbGeo = new THREE.BoxGeometry(20, KERB_H, GROUND_LEN);
  for (const side of [-1, 1]) {
    const kerb = new THREE.Mesh(kerbGeo, kerbMat);
    kerb.position.set(side * (BALLAST_HALF_W + 15), BALLAST_Y - 26 + KERB_H / 2, 0);
    kerb.castShadow = true;
    kerb.receiveShadow = true;
    scene.add(kerb);
  }

  // ── Recycled rows: lamps, then houses once their models land ───────────────
  interface Row { obj: THREE.Object3D; slot: number; spacing: number; slots: number; near: number }
  const rows: Row[] = [];

  const lampX = BALLAST_HALF_W + 78;
  for (const side of [1, -1] as const) {
    for (let s = 0; s < LAMP_SLOTS; s++) {
      const lamp = makeLamp();
      lamp.position.x = side * lampX;
      lamp.position.y = BALLAST_Y - 26;
      lamp.rotation.y = side === 1 ? 0 : Math.PI;
      scene.add(lamp);
      // Offset one side by half a spacing so the two rows do not flash past in
      // lockstep, which is what makes a repeating row read as a repeating row.
      rows.push({ obj: lamp, slot: s + (side === 1 ? 0 : 0.5), spacing: LAMP_SPACING, slots: LAMP_SLOTS, near: 120 });
    }
  }

  const loader = new GLTFLoader();
  Promise.all(['house1', 'house2'].map(n =>
    loader.loadAsync(GLB(n)).then(g => { enableShadows(g.scene); return g; })
  )).then(models => {
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
      for (const side of [1, -1] as const) {
        for (let s = i; s < HOUSE_SLOTS; s += models.length) {
          const obj = model.clone(true);
          obj.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
          obj.scale.multiplyScalar(0.94 + ((s + i) % 3) * 0.03);
          // Measure after orientation and scale: model-local width is not the
          // street-facing width once the house has turned toward the track.
          const bounds = new THREE.Box3().setFromObject(obj);
          const width = bounds.getSize(new THREE.Vector3()).x;
          groundIt(obj);
          obj.position.x = side * (BALLAST_HALF_W + HOUSE_SETBACK + width / 2);
          obj.position.y += BALLAST_Y - 26;
          scene.add(obj);
          rows.push({
            obj,
            slot: s + (side === 1 ? 0 : 0.5),
            spacing: HOUSE_SPACING,
            slots: HOUSE_SLOTS,
            near: HOUSE_NEAR,
          });
        }
      }
    });
  });

  function update(cameraZ: number): void {
    // Sleepers: shift the whole row by the remainder, never further than one gap.
    track.position.z = trackTravelOffset(cameraZ, SLEEPER_SPACING);
    // Plane local +V points toward world -Z after rotation. Increasing the
    // offset therefore moves the visible grain toward +Z with the scenery.
    ballastTex.offset.y = cameraZ / TEXTURE_TILE;
    vergeTex.offset.y = cameraZ / TEXTURE_TILE;

    // Everything else wraps slot by slot, always beyond the fog.
    for (const r of rows) {
      r.obj.position.z = recycledRowZ(cameraZ, r.slot, r.spacing, r.slots, r.near);
    }
  }

  function dispose(): void {
    for (const d of disposables) d.dispose();
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose();
    });
  }

  return { update, sun, dispose };
}
