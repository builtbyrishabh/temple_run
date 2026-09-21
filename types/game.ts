// ─────────────────────────────────────────────────────────────────────────────
// types/game.ts  –  All shared TypeScript interfaces for the Temple Run game
// ─────────────────────────────────────────────────────────────────────────────

export type GameStatus = 'menu' | 'starting' | 'playing' | 'paused' | 'gameover';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type PlayerAction = 'running' | 'jumping' | 'sliding';
export type Lane = 0 | 1 | 2;

/** Obstacles that occupy the corridor and can be collided with. */
export type SolidObstacleType = 'WALL' | 'LOW_WALL' | 'HIGH_BAR';
export type ObstacleType = SolidObstacleType | 'TURN_LEFT' | 'TURN_RIGHT';

// ── Player ────────────────────────────────────────────────────────────────────
export interface Player {
  lane: Lane;           // current (from) lane
  targetLane: Lane;     // destination lane
  laneT: number;        // 0→1  progress of lane change
  action: PlayerAction;
  actionT: number;      // 0→1  progress through current action
  actionDuration: number; // total frames for current action
  worldY: number;       // height above ground (world units); 0 = on ground
  animFrame: number;    // 0-3 running leg animation
  animTimer: number;
}

// ── Obstacles ─────────────────────────────────────────────────────────────────
export interface Obstacle {
  id: number;
  type: ObstacleType;
  lane: Lane | -1;   // -1 means all lanes (turn wall or full barrier)
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

// ── VFX ───────────────────────────────────────────────────────────────────────
export interface Particle {
  x: number;   // screen coordinates
  y: number;
  vx: number;
  vy: number;
  life: number;     // frames remaining
  maxLife: number;
  color: string;
  size: number;
}

// ── Turn warning ──────────────────────────────────────────────────────────────
export interface TurnWarning {
  direction: 'left' | 'right';
  timer: number;    // frames remaining to react
  maxTimer: number;
  worldZ: number;   // absolute Z of the turn gate
  completed: boolean;
}

// ── Presentation events ──────────────────────────────────────────────────────
/** A one-step fact the presentation layer can turn into sound and 3D effects. */
export type RunEvent =
  | { kind: 'coin'; lane: Lane; worldZ: number }
  | { kind: 'crash'; lane: Lane; worldZ: number; obstacle: SolidObstacleType | 'TURN' };

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
  particles: Particle[];
  /** Cleared at the start of each simulation step. */
  events: RunEvent[];
  highScore: number;
  scoreMultiplier: number;
  nextObstacleZ: number;  // world-Z at which to spawn next obstacle cluster
  nextCoinZ: number;
  nextTurnZ: number;
  frameCount: number;
  turnWarning: TurnWarning | null;
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
