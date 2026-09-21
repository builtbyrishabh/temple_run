'use client';
// ─────────────────────────────────────────────────────────────────────────────
// app/page.tsx  –  Root game page – orchestrates all screens
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import MainMenu  from '@/components/game/MainMenu';
import HUD       from '@/components/game/HUD';
import GameOver  from '@/components/game/GameOver';
import PauseMenu from '@/components/game/PauseMenu';
import { getAllHighScores, useAllHighScores } from '@/hooks/useHighScore';
import type { Difficulty } from '@/types/game';

// Canvas uses browser APIs – load only on client
const GameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });

type Screen = 'menu' | 'playing' | 'gameover';

interface RunResult { score: number; distance: number; coins: number; }

// Shared live HUD state passed up from GameCanvas via callback
interface LiveState {
  score: number; distance: number; coins: number;
  multiplier: number; speed: number;
}

export default function Home() {
  const [screen,     setScreen]     = useState<Screen>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isPaused,   setIsPaused]   = useState(false);
  const [soundOn,    setSoundOn]    = useState(true);
  const [result,     setResult]     = useState<RunResult | null>(null);
  const { highScores, refresh: refreshScores } = useAllHighScores();
  const [liveState,  setLiveState]  = useState<LiveState>({
    score: 0, distance: 0, coins: 0, multiplier: 1, speed: 8,
  });


  const handleStart = useCallback((d: Difficulty) => {
    setDifficulty(d);
    setIsPaused(false);
    setResult(null);
    setScreen('playing');
  }, []);

  const handleGameOver = useCallback((score: number, distance: number, coins: number) => {
    const prev = getAllHighScores()[difficulty];
    if (score > prev && typeof window !== 'undefined') {
      localStorage.setItem(`tr_highscore_${difficulty}`, String(Math.floor(score)));
    }
    refreshScores();
    setResult({ score, distance, coins });
    setScreen('gameover');
  }, [difficulty, refreshScores]);

  const handleRestart = useCallback(() => {
    setIsPaused(false);
    setResult(null);
    setScreen('playing');
  }, []);

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

        {/* ── Active game ── */}
        {screen === 'playing' && (
          <div key="game" className="absolute inset-0">
            <GameCanvas
              difficulty={difficulty}
              highScore={highScores[difficulty]}
              onGameOver={handleGameOver}
              onPause={togglePause}
              isPaused={isPaused}
              soundOn={soundOn}
              onLiveState={setLiveState}
            />

            <HUD
              score={liveState.score}
              distance={Math.floor(liveState.distance)}
              coins={liveState.coins}
              highScore={highScores[difficulty]}
              multiplier={liveState.multiplier}
              speed={liveState.speed}
            />

            <AnimatePresence>
              {isPaused && (
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
            </AnimatePresence>
          </div>
        )}

        {/* ── Game over ── */}
        {screen === 'gameover' && result && (
          <div key="gameover" className="absolute inset-0">
            {/* Keep the last frame of the canvas visible behind the overlay */}
            <div className="absolute inset-0 opacity-30 pointer-events-none">
              <GameCanvas
                difficulty={difficulty}
                highScore={highScores[difficulty]}
                onGameOver={() => {}}
                onPause={() => {}}
                isPaused={true}
                soundOn={false}
                onLiveState={() => {}}
              />
            </div>
            <GameOver
              score={result.score}
              distance={result.distance}
              coins={result.coins}
              highScore={highScores[difficulty]}
              isNewHigh={isNewHigh}
              difficulty={difficulty}
              onRestart={handleRestart}
              onMenu={() => { refreshScores(); setScreen('menu'); }}
            />
          </div>
        )}

      </AnimatePresence>
    </main>
  );
}
