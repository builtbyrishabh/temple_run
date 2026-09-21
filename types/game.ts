// ─────────────────────────────────────────────────────────────────────────────
// types/game.ts  –  All shared TypeScript interfaces for the Temple Run game
// ─────────────────────────────────────────────────────────────────────────────

export type GameStatus = 'menu' | 'starting' | 'playing' | 'paused' | 'gameover';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type PlayerAction = 'running' | 'jumping' | 'sliding';
export type Lane = 0 | 1 | 2;

/** Everything the corridor can put in the runner's way. All of it is solid. */
export type ObstacleType = 'WALL' | 'LOW_WALL' | 'HIGH_BAR';

// ── Player ────────────────────────────────────────────────────────────────────
export interface Player {
  lane: Lane;           // current (from) lane
  targetLane: Lane;     // destination lane
  laneT: number;        // 0→1  progress of lane change
  action: PlayerAction;
  actionT: number;      // 0→1  progress through current action
  actionDuration: number; // total frames for current action
  worldY: number;       // height above ground (world units); 0 = on ground
}

// ── Obstacles ─────────────────────────────────────────────────────────────────
export interface Obstacle {
  id: number;
  type: ObstacleType;
  lane: Lane | -1;   // -1 means all lanes (full-width barrier)
  worldZ: number;    // absolute world-Z position
  passed: boolean;   // already behind the player
}

// ── Collectibles ──────────────────────────────────────────────────────────────
export interface CoinItem {
  id: number;
  lane: Lane;
  worldZ: number;
  collected: boolean;
}

// ── Run events ────────────────────────────────────────────────────────────────
/**
 * Something that happened during one simulation step, in world coordinates.
 *
 * The engine does not own effects: it says *what* happened and leaves how it
 * looks and sounds to the layers that present it. Cleared at the start of every
 * step, so whoever reads them has to read them right after the step that
 * produced them — which is exactly where sound and sparks are triggered.
 */
export type RunEvent =
  | { kind: 'coin';  lane: Lane; worldZ: number }
  | { kind: 'crash'; lane: Lane; worldZ: number; obstacle: ObstacleType };

// ── Full game state ───────────────────────────────────────────────────────────
export interface GameState {
  status: GameStatus;
  difficulty: Difficulty;
  score: number;
  distance: number;   // meters
  coins: number;
  speed: number;      // world-Z units per frame
  cameraZ: number;    // how far we have traveled
  player: Player;
  obstacles: Obstacle[];
  coinItems: CoinItem[];
  /** What happened during the step just taken. Valid until the next one. */
  events: RunEvent[];
  highScore: number;
  nextObstacleZ: number;  // world-Z at which to spawn next obstacle cluster
  nextCoinZ: number;
  frameCount: number;
  idCounter: number;
}

// ── Input (one frame snapshot) ────────────────────────────────────────────────
export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  pause: boolean;
}
// ── External driver (optional) ────────────────────────────────────────────────
/**
 * Something other than a human driving the runner: it watches each frame and
 * supplies input pulses in the same vocabulary the keyboard produces.
 *
 * The game deliberately knows nothing about who or what is on the other end —
 * only that input can come from somewhere that also wants to see the state.
 */
export interface GameDriver {
  /** Called once per frame with the live state, immediately before the update. */
  observe: (state: Readonly<GameState>) => void;
  /** Whatever the driver wants pressed on this frame. */
  consume: () => Partial<InputState>;
}
