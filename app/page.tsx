'use client';
// ─────────────────────────────────────────────────────────────────────────────
// app/page.tsx  –  Root game page – orchestrates all screens
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import MainMenu  from '@/components/game/MainMenu';
import HUD       from '@/components/game/HUD';
import GameOver  from '@/components/game/GameOver';
import PauseMenu from '@/components/game/PauseMenu';
import { getAllHighScores, useAllHighScores } from '@/hooks/useHighScore';
import type { LiveState } from '@/components/game/GameCanvas';
import type { Difficulty } from '@/types/game';

// Canvas uses browser APIs – load only on client
const GameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });

type Screen = 'menu' | 'playing' | 'gameover';

interface RunResult { score: number; distance: number; coins: number; }

export default function Home() {
  const [screen,     setScreen]     = useState<Screen>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isPaused,   setIsPaused]   = useState(false);
  const [soundOn,    setSoundOn]    = useState(true);
  const [result,     setResult]     = useState<RunResult | null>(null);
  // Identifies the run the canvas is showing. Bumping it is the only thing
  // that starts a new one, so 'play again' and 'start' are the same path.
  const [runId,      setRunId]      = useState(0);
  const { highScores, refresh: refreshScores } = useAllHighScores();
  const [liveState,  setLiveState]  = useState<LiveState>({
    score: 0, distance: 0, coins: 0, speed: 8,
  });

  const beginRun = useCallback(() => {
    setIsPaused(false);
    setResult(null);
    setRunId(n => n + 1);
    setScreen('playing');
  }, []);

  const handleStart = useCallback((d: Difficulty) => {
    setDifficulty(d);
    beginRun();
  }, [beginRun]);

  const handleGameOver = useCallback((score: number, distance: number, coins: number) => {
    const prev = getAllHighScores()[difficulty];
    if (score > prev && typeof window !== 'undefined') {
      localStorage.setItem(`tr_highscore_${difficulty}`, String(Math.floor(score)));
    }
    refreshScores();
    setResult({ score, distance, coins });
    setScreen('gameover');
  }, [difficulty, refreshScores]);

  const togglePause = useCallback(() => setIsPaused(p => !p), []);
  const toggleSound = useCallback(() => setSoundOn(s => !s), []);

  const isNewHigh = result
    ? Math.floor(result.score) >= (highScores[difficulty] || 0) && result.score > 0
    : false;

  return (
    <main className="fixed inset-0 bg-black overflow-hidden">
      <AnimatePresence mode="wait">

        {/* ── Main menu ── */}
        {screen === 'menu' && (
          <MainMenu
            key="menu"
            onStart={handleStart}
            soundOn={soundOn}
            onToggleSound={toggleSound}
          />
        )}

        {/* ── The run ──
            One canvas, mounted from the first frame of a run to the last. Game
            over is an overlay on top of it, not a screen that replaces it: the
            crash the player is being shown the results of is still on screen
            behind them, because it is the same renderer that drew it. */}
        {screen !== 'menu' && (
          <div key="game" className="absolute inset-0">
            <GameCanvas
              runId={runId}
              difficulty={difficulty}
              highScore={highScores[difficulty]}
              onGameOver={handleGameOver}
              onPause={togglePause}
              isPaused={isPaused}
              soundOn={soundOn}
              onLiveState={setLiveState}
            />

            {screen === 'playing' && (
              <HUD
                score={liveState.score}
                distance={Math.floor(liveState.distance)}
                coins={liveState.coins}
                highScore={highScores[difficulty]}
                speed={liveState.speed}
              />
            )}

            <AnimatePresence>
              {isPaused && screen === 'playing' && (
                <PauseMenu
                  key="pause"
                  score={liveState.score}
                  distance={Math.floor(liveState.distance)}
                  onResume={togglePause}
                  onMenu={() => { setScreen('menu'); setIsPaused(false); }}
                  soundOn={soundOn}
                  onToggleSound={toggleSound}
                />
              )}

              {screen === 'gameover' && result && (
                <GameOver
                  key="gameover"
                  score={result.score}
                  distance={result.distance}
                  coins={result.coins}
                  highScore={highScores[difficulty]}
                  isNewHigh={isNewHigh}
                  difficulty={difficulty}
                  onRestart={beginRun}
                  onMenu={() => { refreshScores(); setScreen('menu'); }}
                />
              )}
            </AnimatePresence>
          </div>
        )}

      </AnimatePresence>
    </main>
  );
}
