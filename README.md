# Jev plays Temple Run

**Jev**, TypeSafe AI's System One decision model, playing a neon endless runner
live — on structured game state, never pixels — in a browser you can watch.

Three lanes, walls to dodge, bars to slide under, gates that demand a turn. Jev
picks every move.

```bash
npm install
cp .env.example .env.local   # add AI_GATEWAY_API_KEY
npm run dev                  # -> http://localhost:3000/watch
```

`/` is the game, unchanged, for a human to play. `/watch` is the scene.

With no key it runs a **clearly-labelled offline stand-in** so the scene still
works. The stand-in is a keyword rule over the same sentences, not a model. It
tells you nothing about Jev, and the panel marks every decision it makes `MOCK`.

Built on [GameHelix/temple_run](https://github.com/GameHelix/temple_run) — the
game is upstream's, the decision loop is not.

---

## The layers

The whole point of the exercise is that these stay apart. The game does not know
an AI exists; Jev does not know the game exists; exactly one layer touches both.

```
  presentation   components/jev/JevScene.tsx     the watch view
                 components/jev/JevPanel.tsx     what Jev saw and chose
                        ▲ live decision + game stats
  ────────────────────────────────────────────────────────────────
  control        hooks/useJevDriver.ts           ask on a cadence, press on time
                        │ Sensors                ▲ InputState
  ────────────────────────────────────────────────────────────────
  sensing        lib/jev/sensors.ts              GameState → Sensors (pure)
  timing         lib/jev/timing.ts               the arithmetic Jev never does
  contract       lib/jev/contract.ts             the shared vocabulary
                        │
  ────────────────────────────────────────────────────────────────
  decision       app/api/jev/route.ts            the key never reaches the browser
  (server)       lib/jev/pilot.ts                AI SDK → gateway → typesafe-ai/jev
  ────────────────────────────────────────────────────────────────
  game           lib/game/engine.ts              rules, spawning, balance
                 lib/game/renderer3d.ts          draws GameState, never writes it
```

The game layer gained exactly one thing — a `GameDriver` interface in
`types/game.ts`, and four lines in `GameCanvas` that call it:

```ts
export interface GameDriver {
  observe: (state: Readonly<GameState>) => void;
  consume: () => Partial<InputState>;
}
```

It says *"input can come from somewhere that also wants to see the state"*, and
nothing more. `GameCanvas` takes an optional `driver` prop; when one is present
the keyboard is ignored, so there is never any doubt about who moved the runner.
Swap in a different decision maker and not a line of game code changes.

## What Jev actually sees

Not pixels, and not lane indices either. Every field is pre-computed by the game
and phrased as **the consequence of one move**, so the five `ifIt…` fields line
up one-to-one with the five options of the question:

```jsonc
{
  "stance":          "running in the middle lane",
  "threatIn":        "about 0.9 seconds",
  "ifItDoesNothing": "it runs straight into a low wall, low enough to jump over in the middle lane",
  "ifItStepsLeft":   "it steps into the left lane, where it meets a solid wall that cannot be jumped or slid under",
  "ifItStepsRight":  "it steps into the right lane, which is clear",
  "ifItJumps":       "it clears the low wall cleanly",
  "ifItSlides":      "it slides straight into the low wall"
}
```

The shape follows from Jev's documented failure modes:

- **No arithmetic.** It is never asked to subtract a depth or compare two
  numbers. The game does that and reports the answer.
- **No indirection.** It never has to work out that "lane 0" is to the left, or
  that a low wall is jumpable. Each sentence already says what happens.
- **Nothing it cannot act on.** Feasibility is folded in: when a step can no
  longer finish in time, the field says so rather than describing a lane the
  runner cannot reach.
- **Small.** Seven fields. Large states with irrelevant detail measurably degrade
  Jev's answers.

Two questions per snapshot, in one request:

- **`action`** — a **choice** over `left | right | jump | slide | none`. **This
  is the entire control input.**
- **`danger`** — a **score** on a three-level rubric, for the panel only. Never
  used to play.

Nothing corrects, smooths or vetoes the answer. **Every crash is Jev's.**

## Who decides what

The control layer turns `"jump"` into a keypress at the frame it can land on. It
picks *when*, never *what* — that split is the only reason the claim above holds.
A jump held back until the wall is close is still Jev's jump.

That "when" is not a constant, and getting it wrong is what the first working
version got wrong. The engine does not resolve a collision at a single depth: it
tests every obstacle on every frame from `PLAYER_Z + 120` down to `PLAYER_Z`. A
jump has to stay above the wall for that whole stretch, and how long the stretch
takes depends on how fast the corridor is moving — so the lead is a function of
speed, derived in `lib/jev/timing.ts` from the game's own constants rather than
tuned by hand.

## What made it work

The loop was wrong four times before it was right, and a headless simulation
found all four. Median distance on `medium`, 10+ runs per stage:

| | median |
|---|---|
| first working version | 51m |
| don't report turn gates that cannot be answered yet | 64m |
| time jumps against the collision window, not a point | 79m |
| keep reporting obstacles that are alongside the runner | 106m |
| drop a sideways answer if the runner already moved | 116m |

*(Measured before Jev's real latency was known, against an assumed 70–500ms, and
against the old corridor. The absolute numbers mean nothing now — see
**The corridor was the bug** below. The relative progression is the point: every
step was a real bug, and each one was worth real distance.)*

Each was invisible from the outside and each looks like "the model is bad at
this" until you trace it frame by frame:

1. **A gate you cannot answer yet is noise.** Turn gates arm at depth 700, and
   pressing early does literally nothing. Reporting one from depth 1800 meant
   every decision for four seconds went to a turn that was not live, while a
   wall closed in. The runner pinned itself against the left wall and died.

2. **The collision window has width.** Timing jumps to arrive at `PLAYER_Z` put
   take-off ~13 frames late; the runner jumped *into* walls. The arc clears a
   low wall only between frames 9 and 25, and the window takes 4–15 frames to
   cross depending on speed, so the take-off point has to be centred on it.

3. **An obstacle beside you can still kill you.** The sensor dropped obstacles
   at `PLAYER_Z`, but the engine keeps testing them for another 100 units. So it
   reported a lane as clear while a low wall sat in it, and the runner stepped
   straight in.

4. **"Step left" decays.** A sideways move is relative to the lane it was asked
   about. At ~430ms round trip the runner has often already moved by the time
   the answer lands, and applying it anyway makes it oscillate. Jumps and slides
   are absolute and unaffected — only lateral answers need the guard.

### The loop matters more than the model

Jev answers in **378–608ms** measured live through the gateway (median 428ms).
That is most of a reaction window, so the loop issues on a fixed 140ms cadence
and never waits for the previous answer; out-of-order replies are dropped by
sequence number. 30 runs each, same reference pilot, same latency distribution,
capped at five minutes:

| decision loop | medium | hard |
|---|---|---|
| serial | 797m | 805m |
| pipelined | **3628m** | **2535m** |

The 140ms cadence is not arbitrary either — 180ms costs most of that back, and
120ms buys nothing while billing 17% more requests.

### The corridor was the bug

The loop above was already right, and the runner still died in eight seconds on
hard. The fault was arithmetic in the game, not judgment in the model: obstacle
spacing was a fixed *distance*, so as speed ramped 8 → 30 the **time** between
waves collapsed to 0.14s, while everything the runner can do costs a fixed
number of frames that never shrank — a jump is 34 of them. One jump spanned
three obstacle slots. Those were not skill failures; there was no input that
survived.

Spacing is now held in **seconds** and multiplied by the speed of the moment, so
the reaction window is constant all the way to MAX_SPEED (`MIN_GAP_SECONDS` in
`lib/constants.ts`). Two consequences follow:

- Raw speed no longer costs reaction time, so it can no longer be the thing that
  makes a run get harder. The gap instead *tightens* along the speed ramp, from
  2.2s down to the difficulty's floor, and the ramp is what differentiates the
  difficulties — easy takes 3½ minutes to reach its endgame, hard just over one.
- The floor is derived rather than guessed. One answer costs the previous wave
  finishing its crossing of the collision window, plus the decision cadence, plus
  a round trip, plus the lead a jump needs: about 1.4s at the opening speed and
  1.2s at MAX_SPEED. That is exactly where `MIN_GAP_SECONDS` sits.

Turn gates had the same bug in miniature — they armed at a fixed depth and then
counted down in frames, so at speed a gate armed a quarter of a second before it
swept past and went on demanding an answer for two more. They now arm a fixed
*time* out, and that time is the answer window.

The last piece was content. `[WALL, HIGH_BAR, WALL]` — walls left and right, a
bar between them — is survivable only by being in the middle lane *and* sliding,
which is two moves, and a wave only ever affords one. Patterns are filtered
through `isAnswerableFrom` in `lib/game/engine.ts`, which is what makes "every
wave has an answer" true rather than intended.

Reference pilot, 40 runs, the 120s cap:

| | before | after |
|---|---|---|
| easy | 147m · survived 0/40 | **813m · 40/40** |
| medium | 47m · survived 0/40 | **1041m · 31/40** |
| hard | 42m · survived 0/40 | **1340m · 38/40** |

Distances are not comparable across difficulties any more, because each now has
its own speed ramp. Past the cap, at five minutes, the curve separates: easy
30/30, hard 20/30, medium 7/30.

### The corridor was also too short

Making the scene look like an endless street meant building the world further
ahead — haze can only hide an obstacle appearing if the haze reaches that far,
and haze that close reads as a wall rather than as distance. `SPAWN_Z` went from
2000 to 5600, and the balance immediately fell apart: medium dropped from 50/60
runs surviving to 15/60.

The cause is worth writing down, because it was load-bearing and invisible.
Obstacles only ever existed as far ahead as they were spawned, so at 2000 the
corridor was genuinely **empty 16% of the time** — not by design, but because the
world had not been built yet. Those accidental empty stretches were when the
pilot answered turn gates, and the gate constants had been tuned, unknowingly,
to depend on them. Building the world properly deep removed them: the corridor
now has something in view 98.5% of the time, which is honest, and harder.

Two changes followed:

- `nextWave` now ignores anything past `DECISION_HORIZON_FRAMES`. It used to
  report the nearest obstacle *however far away*, which at the old depth was
  tolerable and at the new one meant every consequence line described a wave
  eight seconds out — so a lane that was clear read as blocked, and a turn gate
  asking for it got refused.
- Spacing a wave correctly now needs the speed the corridor will be moving at
  when the runner *arrives*, not the speed it is moving at when the wave is
  placed. Over 5600 units of accelerating track those differ by enough to eat a
  third of the gap.

The gate window and gate spacing were then re-tuned against the honest world.

### Why the scene defaults to easy

Because it is the one that reliably fills two minutes of footage. All three are
now answerable end to end; they differ in what a wave asks for — easy blocks one
lane and standing still is often the answer, hard engages all three and leans on
walls, which can only be answered by a sideways step, the one move a stale
decision ruins.

## Measuring it

```bash
npm run simulate                 # 10 runs, medium, pipelined
bun run scripts/simulate.ts 40 easy
bun run scripts/simulate.ts 30 medium serial
CAP_SECONDS=300 bun run scripts/simulate.ts 30 hard   # past the two-minute cap
```

Runs the real engine, the real sensors and the real scheduler against a
**reference pilot** — a rule that scores the same five sentences Jev reads —
under the measured latency distribution. Runs are seeded by index, so two
versions of the loop are compared over the same worlds. No API calls, no key, no
cost. If the runner dies here it is the game's or the loop's fault, and no amount
of prompting will fix it.

## Watching it

`npm run dev`, then <http://localhost:3000/watch>. The panel shows Jev's chosen
move, its probability across all five options, the danger read, round-trip
latency, and what the run has cost. The distribution is the interesting part: a
0.99 slide and a 0.40/0.38 coin-flip are very different decisions, and only one
of them looks decisive.

A run costs at most about **1.3 cents a minute** — 739 input tokens per decision
at $0.000000042/token, seven decisions a second. Less in practice, because an
empty corridor is not worth a question and the loop does not ask one. Jev's
output tokens are free.

## Files

| File | Role |
|---|---|
| `lib/jev/contract.ts` | `Sensors` / `Decision`, shared by every layer |
| `lib/jev/sensors.ts` | Game state → the corridor as Jev sees it. Pure. |
| `lib/jev/timing.ts` | Collision window, jump/slide leads, feasibility |
| `lib/jev/pilot.ts` | The two questions, the gateway call, the stand-in |
| `app/api/jev/route.ts` | HTTP boundary; the key stays server-side |
| `hooks/useJevDriver.ts` | Pipelined decision loop + press scheduler |
| `components/jev/JevScene.tsx` | The scene |
| `components/jev/JevPanel.tsx` | Decision readout |
| `scripts/simulate.ts` | The same loop, headless, for measurement |
| `types/game.ts` | Upstream, plus the `GameDriver` interface |
| `components/game/GameCanvas.tsx` | Upstream, plus the optional `driver` prop |
| `lib/game/engine.ts` | Rules, spawning, and the balance that makes waves answerable |
| `lib/constants.ts` | Every tunable, including the spacing-in-seconds floors |
| `lib/game/renderer3d.ts` | three.js scene; reads `GameState`, never writes it |

## The game itself

A three-lane endless runner drawn with three.js. `WALL` — a train — needs a lane
change, `LOW_WALL` a jump, `HIGH_BAR` a slide, and one contact ends the run.
Coins, and a speed ramp from 8 to 30 units/frame that tightens the gap between
waves as it goes.

Human controls at `/`: `←→` lanes, `↑`/space jump, `↓` slide, `P` pause.

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router |
| Model access | Vercel AI SDK `experimental_evaluate` → AI Gateway → `typesafe-ai/jev` |
| Rendering | three.js (WebGL) |
| Audio | Web Audio API (procedural) |
| Styling | Tailwind CSS v4, Framer Motion |

## Configuration

| Variable | Purpose |
|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway credential for `typesafe-ai/jev`. Unset → offline stand-in. |

## License

MIT, as upstream.
