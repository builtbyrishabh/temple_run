# Handover: fix the game design in `jev-play-temple-run`

## What this project is

A three-lane endless runner in Next.js where **Jev** (TypeSafe AI's decision model)
plays live in the browser, deciding every move from structured game state rather
than pixels. `/` is the human game, `/watch` is the Jev scene.

The architecture's whole point is that the layers stay apart. Read `README.md`
first — it documents the layering, and it is accurate:

```
presentation  components/jev/JevScene.tsx, JevPanel.tsx
control       hooks/useJevDriver.ts          ask on a cadence, press on time
sensing       lib/jev/sensors.ts             GameState → Sensors (pure)
timing        lib/jev/timing.ts              the arithmetic Jev never does
contract      lib/jev/contract.ts            the shared vocabulary
decision      app/api/jev/route.ts, lib/jev/pilot.ts   (server; key never reaches browser)
game          lib/game/engine.ts             knows nothing about any AI
```

The game layer's only concession to the AI is the `GameDriver` interface in
`types/game.ts` and four lines in `GameCanvas`. **Keep it that way.**

---

## Your job

**The graphics are now fine. The game design is not.** The runner dies almost
immediately and it is not fun to watch. Fix the game feel and balance.

This is a *game design and tuning* task, not a rendering task.

### The problem, measured

`scripts/simulate.ts` runs the real engine, real sensors and real scheduler
against a rule-based reference pilot under a latency distribution matching the
live model. Baselines I took (`bun run scripts/simulate.ts <runs> <difficulty>`):

| difficulty | median distance | best | worst | survived 120s |
|---|---|---|---|---|
| easy | 185 m (36 s) | 264 m | 90 m | **0 / 12** |
| medium | 56 m (~13 s) | 86 m | 38 m | **0 / 12** |
| hard | 36 m (~8 s) | 52 m | 24 m | **0 / 10** |

Nobody survives the two-minute cap on any difficulty. A median hard run lasts
**eight seconds**. Crucially this is the *reference pilot*, not the model — as
that script's own header says, if the runner dies here it is the loop's fault,
not Jev's, and no amount of prompting will fix it.

### Why, arithmetically

The engine runs at 60 fps. `state.speed` is in world-units per frame, so
units/second = `speed × 60`. From `lib/constants.ts`:

- `INITIAL_SPEED 8` → `MAX_SPEED 30`, i.e. **480 → 1800 units/sec**
- `SPEED_INCREASE 0.0025`/frame → **~147 s to reach max speed**
- obstacle spacing is `MIN_GAP[difficulty] + randInt(0, 200)`, and
  `MIN_GAP = { easy: 600, medium: 400, hard: 260 }`

So the **time between obstacles** collapses as speed rises:

| difficulty | at speed 8 | at speed 30 |
|---|---|---|
| easy | 1.25 – 1.67 s | 0.33 – 0.44 s |
| medium | 0.83 – 1.25 s | 0.22 – 0.33 s |
| hard | 0.54 – 0.96 s | **0.14 – 0.26 s** |

Meanwhile **actions commit the runner for a fixed number of frames**, and those
windows do not shrink:

| action | frames | seconds | distance at max speed |
|---|---|---|---|
| lane change | 12 | 0.20 s | 360 u |
| slide | 30 | 0.50 s | 900 u |
| jump | 34 | 0.57 s | 1020 u |
| stumble | 40 | 0.67 s | 1200 u |
| invincible | 120 | 2.00 s | 3600 u |

On hard at max speed, **a single jump spans 2–4 obstacle slots**. You are
airborne across obstacles you cannot respond to, and you land into whatever is
there. A stumble (0.67 s) covers 1200 units — more than four hard gaps — so one
mistake cascades into death. These are unavoidable deaths, not skill failures.

### Three specific suspects

1. **Commitment windows exceed the obstacle interval** (above). Either the gap
   must scale with speed, or action durations must, or `MAX_SPEED` must come
   down. Consider making spacing a function of speed so the *time* between
   obstacles has a floor (e.g. never below ~0.8 s) instead of the distance
   having one.

2. **Some patterns have exactly one survivable answer.** In `lib/game/engine.ts`,
   `HARD_PATTERNS[0]` is `[['WALL',0],['HIGH_BAR',1],['WALL',2]]` — walls left
   and right, bar in the middle. The only survival is *be in lane 1 **and**
   slide*. If the runner is in lane 0 when that spawns 260 units out (0.14 s at
   max speed) it must lane-change (0.20 s) **and** slide (0.50 s). Impossible.
   `[['LOW_WALL',0],['WALL',1],['LOW_WALL',2]]` has the same shape. Validate
   that every spawned pattern is reachable given current speed and the runner's
   current lane, and reject or defer the ones that are not.

3. **Decision staleness.** `DECISION_INTERVAL_MS = 140` in
   `hooks/useJevDriver.ts:27`, and requests are deliberately never awaited.
   Live latency I measured through the gateway was **683 ms**; the simulator's
   median was 441–468 ms. So 3–5 requests are in flight at once and every answer
   describes a world ~0.5 s old — around 900 units at max speed, i.e. more than
   two hard-difficulty gaps. The sensing layer's horizon
   (`DECISION_HORIZON_FRAMES = 132` in `lib/jev/timing.ts`) needs to be
   reconciled with that. Note the 140 ms cadence also means ~7 gateway requests
   per second, which is real money.

### Verify with numbers, not vibes

Use the simulator as the objective function. Run it before and after every
change:

```bash
bun run scripts/simulate.ts 20 hard
bun run scripts/simulate.ts 20 medium
bun run scripts/simulate.ts 20 easy
bun run scripts/simulate.ts 20 hard serial   # un-pipelined loop, for comparison
```

A reasonable target: the reference pilot should survive the 120 s cap on easy
most of the time, and get well past 60 s on hard. Tune until the numbers say so,
then confirm visually at `/watch`.

---

## What was just done (context, not your task)

The 2D canvas renderer was replaced with a three.js one. **Do not redo this.**

- **New** `lib/game/renderer3d.ts` (431 lines) — reads `GameState`, never writes
  it. Obstacle models are scaled to the hitboxes the engine already enforces, so
  what you see is what collides: `WALL` → subway train, `LOW_WALL` → kerb stone
  (jump), `HIGH_BAR` → hurdle (slide).
- **New** `public/assets/` — 15 GLB models + 2 textures (~40 MB), taken from
  `DanielLin0516/SUBWAY-SURFERS`. Mostly CC-BY-4.0 Sketchfab models; `house3` is
  CC-BY-**NC**; `player1.glb` has no license or author. **The owner has decided
  licensing is out of scope — this is being used to produce a video, not
  shipped.** Do not spend time on it.
- **Modified** `components/game/GameCanvas.tsx` — five small edits to use the new
  renderer.
- **Added** `three` + `@types/three`.
- `lib/game/renderer.ts` (the original 2D renderer) is intact but no longer
  imported. Useful as a reference for the projection conventions.

Coordinate mapping used by the 3D renderer:

```
x =  worldX                lane centres LANE_WORLD_X = [-72, 0, 72]
y =  worldY                0 = ground, up positive
z = -(worldZ - cameraZ)    camera plane at 0, track ahead negative
```

so the runner sits at `z = -PLAYER_Z` and obstacles slide toward it.

### Known rough edges in the renderer (low priority)

- The rail texture reads tan rather than grey gravel. The source project used
  `low_road.glb` as ground geometry instead of a textured plane; that is
  probably better and the asset is already in `public/assets/glb/`.
- Houses lean cottage rather than city row-house — that is just what this asset
  set contains.
- No post-processing. Bloom on the coins plus SMAA is the next visual step.
- The main menu has a **pre-existing** hydration warning (the `1 Issue` badge in
  dev) from the localStorage high score in `MainMenu.tsx`. Unrelated to the
  renderer.
- `THREE.PCFSoftShadowMap` was removed in three 0.186 — use `PCFShadowMap`.

---

## Conventions and constraints

From the owner's standing preferences:

- **KISS and YAGNI.** No new framework, service, pattern or dependency where a
  local solution works. Rule of Three before generalising.
- **TypeScript properly.** `any` is the enemy; prefer inferred types.
- Comments explain how things are used, concisely, above functions and classes —
  and **must be kept in sync** when behaviour changes. The existing code follows
  this closely; match it.
- Tests should be focused. No smoke-test sprawl.
- Be careful with destructive actions that were not explicitly requested.
- Questions are read-only: if asked "how hard would it be" or "what do you
  think", answer, do not edit.

### Do not touch without a very good reason

- `lib/jev/contract.ts` — changing `Sensors` or `Decision` means changing the
  prompt, the sensing layer and the panel together.
- The layering. The engine must not learn that an AI exists.
- `public/assets/` — the art is settled.

### Running it

```bash
npm install
npm run dev          # http://localhost:3000  (/ human, /watch Jev)
npm run typecheck    # tsc --noEmit; keep it clean
bun run scripts/simulate.ts 20 hard    # the objective function
```

`AI_GATEWAY_API_KEY` is already set in `.env`. Without it the app falls back to a
clearly-labelled offline stand-in that marks every decision `MOCK`.

### Screenshotting the running game

There is no preview automation host in this environment. To see the game, drive
headless Chrome over CDP:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --user-data-dir=/tmp/chrome-x \
  --window-size=900,1000 --enable-unsafe-swiftshader \
  --remote-debugging-port=9223 http://localhost:3000/ &
```

Then connect to `http://localhost:9223/json/list`, open the page's
`webSocketDebuggerUrl`, and use `Runtime.evaluate` to click
`[...document.querySelectorAll('button')].find(b => b.textContent.includes('RUN'))`
plus `Page.captureScreenshot`. Note the game does not start until that button is
clicked, and WebGL needs `--enable-unsafe-swiftshader` in headless.
