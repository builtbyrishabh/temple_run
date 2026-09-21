'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/game/GameCanvas.tsx  –  Canvas + game loop wiring
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback, useState } from 'react';
import { useGameLoop }   from '@/hooks/useGameLoop';
import { useInput }      from '@/hooks/useInput';
import { initGameState, updateGame } from '@/lib/game/engine';
import { createRenderer3D, type Renderer3D } from '@/lib/game/renderer3d';
import { initAudio, startMusic, stopMusic, playSfx, setMusicVolume, setSfxVolume } from '@/lib/game/audio';
import type { GameState, Difficulty, GameDriver, InputState } from '@/types/game';

const NO_INPUT: InputState = { left: false, right: false, up: false, down: false, pause: false };

// The engine is a fixed-step simulation — every duration in lib/constants.ts is
// counted in frames at 60fps, and the balance is tuned against that — so the
// step size must not follow the display. One step per animation frame ran the
// whole game at double speed on a 120Hz screen and stuttered whenever a frame
// was dropped; the loop below advances real time instead and hands the renderer
// the leftover fraction so the corridor still slides smoothly between steps.
const STEP_MS = 1000 / 60;

/** Most simulation one animation frame may catch up on, so a stall is not repaid all at once. */
const MAX_CATCHUP_MS = 100;

interface LiveState {
  score: number; distance: number; coins: number;
  multiplier: number; speed: number;
}

interface Props {
  difficulty:   Difficulty;
  highScore:    number;
  onGameOver:   (score: number, distance: number, coins: number) => void;
  onPause:      () => void;
  isPaused:     boolean;
  soundOn:      boolean;
  onLiveState:  (s: LiveState) => void;
  /** When supplied, this drives the runner instead of the keyboard. */
  driver?:      GameDriver;
}

export default function GameCanvas({
  difficulty, highScore, onGameOver, onPause, isPaused, soundOn, onLiveState, driver,
}: Props) {
  const hudTimer = useRef(0);
  /** Simulation time owed but not yet stepped, in ms. Doubles as the render lerp. */
  const carryRef = useRef(0);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const stateRef   = useRef<GameState>(initGameState(difficulty, highScore));
  const { consumeInput, fireInput } = useInput();
  const [started, setStarted] = useState(false);

  // ── WebGL renderer, sized to its container ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r3d = createRenderer3D(canvas);
    rendererRef.current = r3d;
    const ro = new ResizeObserver(() => r3d.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      rendererRef.current = null;
      r3d.dispose();
    };
  }, []);

  // ── Audio init & sounds on state change ────────────────────────────────────
  useEffect(() => {
    initAudio();
    setMusicVolume(soundOn ? 0.18 : 0);
    setSfxVolume(soundOn ? 0.4 : 0);
  }, [soundOn]);

  // ── Restart / re-init when difficulty changes ───────────────────────────────
  useEffect(() => {
    stateRef.current = initGameState(difficulty, highScore);
    stateRef.current.status = 'playing';
    setStarted(true);
    if (soundOn) startMusic();
  }, [difficulty, highScore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── One simulation step ─────────────────────────────────────────────────────
  const step = useCallback((state: GameState, human: InputState) => {
    // Sound cues (sample once per step before update)
    const prevAction = state.player.action;
    const prevCoins  = state.coins;
    const prevStatus = state.status;

    // A driver sees the frame first, then answers for it. While one is
    // attached the keyboard is ignored, so there is never any doubt about
    // who moved the runner.
    driver?.observe(state);
    const input: InputState = driver
      ? { ...NO_INPUT, ...driver.consume() }
      : human;

    updateGame(state, input);

    // Trigger SFX on state changes
    if (soundOn) {
      if (state.player.action !== prevAction) {
        if (state.player.action === 'jumping')  playSfx('jump');
        if (state.player.action === 'sliding')  playSfx('slide');
      }
      // A hit is the end of the run now, so the crash cue rides the transition
      // out of 'playing' rather than the stumble that no longer happens.
      if (state.status === 'gameover' && prevStatus === 'playing') playSfx('hit');
      if (state.coins > prevCoins) playSfx('coin');
      if (state.turnWarning?.completed && state.turnWarning.timer === state.turnWarning.maxTimer - 1) {
        playSfx('turn');
      }
    }

    // Report live state to HUD every ~4 steps
    hudTimer.current++;
    if (hudTimer.current >= 4) {
      hudTimer.current = 0;
      onLiveState({
        score: Math.floor(state.score),
        distance: state.distance,
        coins: state.coins,
        multiplier: state.scoreMultiplier,
        speed: state.speed,
      });
    }
  }, [driver, soundOn, onLiveState]);

  // ── Main loop ───────────────────────────────────────────────────────────────
  const tick = useCallback((dt: number) => {
    const r3d = rendererRef.current;
    if (!r3d) return;

    const state = stateRef.current;

    // Always drained, so held keys never pile up in the queue.
    const human = consumeInput();
    if (human.pause) {
      onPause();
      return;
    }

    // Handle starting countdown  →  just go straight to playing
    if (state.status === 'starting') {
      state.status = 'playing';
    }

    if (!isPaused && state.status === 'playing') {
      carryRef.current = Math.min(carryRef.current + dt, MAX_CATCHUP_MS);
      // A queued keypress belongs to one step, not to every step this frame.
      let pressed: InputState | null = human;
      while (carryRef.current >= STEP_MS && state.status === 'playing') {
        carryRef.current -= STEP_MS;
        step(state, pressed ?? NO_INPUT);
        pressed = null;
      }
    } else {
      carryRef.current = 0;
    }

    // Game over check (outside the 'playing' guard so it fires even after updateGame sets it)
    if (state.status === 'gameover' && !isPaused) {
      stopMusic();
      if (soundOn) playSfx('gameover');
      onGameOver(
        Math.floor(state.score),
        Math.floor(state.distance),
        state.coins
      );
      // Prevent repeated calls
      state.status = 'menu' as typeof state.status;
    }

    r3d.render(state, carryRef.current / STEP_MS);
  }, [consumeInput, isPaused, onGameOver, onPause, soundOn, step]);

  useGameLoop(tick, started);

  // ── Mobile on-screen button handlers ────────────────────────────────────────
  const btn = (key: 'left' | 'right' | 'up' | 'down') => () => fireInput(key);

  return (
    <div className="relative w-full h-full select-none">
      {/* Game canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
      />

      {/* Mobile control buttons */}
      {!driver && (
      <div className="absolute bottom-6 left-0 right-0 flex justify-between items-end px-4 pointer-events-none md:hidden">
        {/* Left / Right */}
        <div className="flex gap-3 pointer-events-auto">
          <MobileBtn label="◀" onPress={btn('left')}  color="cyan" />
          <MobileBtn label="▶" onPress={btn('right')} color="cyan" />
        </div>
        {/* Jump / Slide */}
        <div className="flex flex-col gap-3 pointer-events-auto">
          <MobileBtn label="▲ JUMP"  onPress={btn('up')}   color="purple" />
          <MobileBtn label="▼ SLIDE" onPress={btn('down')} color="orange" />
        </div>
      </div>
      )}

      {/* Pause button. Sits below the HUD's top row rather than in the corner,
          which is where the distance readout lives. The watch scene has its own
          in the control strip, so this one is hidden there. */}
      {!driver && (
      <button
        onClick={onPause}
        className="absolute top-[72px] right-3 text-white/70 hover:text-white text-sm font-mono
                   bg-black/40 backdrop-blur-sm border border-white/15 rounded px-3 py-1.5
                   transition-colors active:scale-95"
      >
        ⏸ PAUSE
      </button>
      )}
    </div>
  );
}

// ── Small mobile control button ───────────────────────────────────────────────

function MobileBtn({
  label, onPress, color,
}: {
  label: string;
  onPress: () => void;
  color: 'cyan' | 'purple' | 'orange';
}) {
  const palette = {
    cyan:   'border-cyan-400   text-cyan-300   active:bg-cyan-400/30',
    purple: 'border-purple-400 text-purple-300 active:bg-purple-400/30',
    orange: 'border-orange-400 text-orange-300 active:bg-orange-400/30',
  }[color];

  return (
    <button
      onTouchStart={e => { e.preventDefault(); onPress(); }}
      onClick={onPress}
      className={`
        w-14 h-14 rounded-xl border-2 font-bold text-xs font-mono
        bg-black/40 backdrop-blur-sm transition-all active:scale-95
        ${palette}
      `}
    >
      {label}
    </button>
  );
}
