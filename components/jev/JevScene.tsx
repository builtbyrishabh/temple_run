'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/jev/JevScene.tsx  –  The scene: Jev plays, you watch
//
// Composition only. It wires the control layer's driver into the game and puts
// the panel beside it. Jev's runs are kept out of the human high-score table on
// purpose — they are not the same leaderboard.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import dynamic from 'next/dynamic';

import HUD from '@/components/game/HUD';
import JevPanel from '@/components/jev/JevPanel';
import { useJevDriver } from '@/hooks/useJevDriver';
import type { LiveState } from '@/components/game/GameCanvas';
import type { Difficulty } from '@/types/game';

const GameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * How long the result card stays up before the next run starts. The crash it
 * reports has already had its own second on screen before this begins.
 */
const RESTART_DELAY_MS = 2600;

interface RunResult { score: number; distance: number; coins: number; }

const INITIAL_LIVE: LiveState = { score: 0, distance: 0, coins: 0, speed: 8 };

export default function JevScene() {
  // Easy by default, and not for the reason it looks like. Medium spaces its
  // obstacle waves 400-600 world units apart, which at the opening speed is
  // 0.67-1.0s — barely two decisions at Jev's measured ~430ms round trip. Easy
  // leaves enough room between waves for the loop to actually keep up.
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [runKey, setRunKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [best, setBest] = useState(0);
  const [live, setLive] = useState<LiveState>(INITIAL_LIVE);

  // Jev only decides while a run is actually in progress.
  const { driver, status } = useJevDriver(!paused && result === null);

  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRun = useCallback(() => {
    setResult(null);
    setLive(INITIAL_LIVE);
    setRunKey(k => k + 1);
  }, []);

  const handleGameOver = useCallback((score: number, distance: number, coins: number) => {
    setBest(b => Math.max(b, score));
    setResult({ score, distance, coins });
  }, []);

  // The scene runs itself: after a crash it shows the result, then goes again.
  useEffect(() => {
    if (!result) return;
    restartTimer.current = setTimeout(startRun, RESTART_DELAY_MS);
    return () => { if (restartTimer.current) clearTimeout(restartTimer.current); };
  }, [result, startRun]);

  const changeDifficulty = useCallback((next: Difficulty) => {
    setDifficulty(next);
    startRun();
  }, [startRun]);

  return (
    <main className="fixed inset-0 flex flex-col bg-[#060014] lg:flex-row">

      {/* ── Stage ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ControlStrip
          difficulty={difficulty}
          onDifficulty={changeDifficulty}
          paused={paused}
          onTogglePause={() => setPaused(p => !p)}
          soundOn={soundOn}
          onToggleSound={() => setSoundOn(s => !s)}
          best={best}
        />

        <div className="relative min-h-0 flex-1">
          <GameCanvas
            runId={runKey}
            difficulty={difficulty}
            /* Jev's runs never touch the human leaderboard. */
            highScore={0}
            onGameOver={handleGameOver}
            onPause={() => setPaused(p => !p)}
            isPaused={paused || result !== null}
            soundOn={soundOn}
            onLiveState={setLive}
            driver={driver}
          />

          <HUD
            score={live.score}
            distance={Math.floor(live.distance)}
            coins={live.coins}
            highScore={best}
            speed={live.speed}
          />

          <AnimatePresence>
            {result && <ResultCard key="result" result={result} best={best} />}
            {paused && !result && (
              <motion.div
                key="paused"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-black/70"
              >
                <p className="glow-cyan text-2xl font-bold tracking-[0.3em] text-cyan-300">PAUSED</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Panel ── */}
      <div className="h-[45vh] shrink-0 lg:h-auto lg:w-[380px]">
        <JevPanel status={status} />
      </div>
    </main>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function ControlStrip({
  difficulty, onDifficulty, paused, onTogglePause, soundOn, onToggleSound, best,
}: {
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  paused: boolean;
  onTogglePause: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  best: number;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2 text-[11px]">
      <span className="mr-1 text-white/35">difficulty</span>
      {DIFFICULTIES.map(d => (
        <button
          key={d}
          onClick={() => onDifficulty(d)}
          className={`rounded border px-2 py-0.5 uppercase tracking-wider transition-colors ${
            d === difficulty
              ? 'border-cyan-400 bg-cyan-400/15 text-cyan-300'
              : 'border-white/15 text-white/40 hover:text-white/70'
          }`}
        >
          {d}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-white/35">jev&apos;s best</span>
        <span className="font-bold text-white/80 tabular-nums">{best.toLocaleString()}</span>
        <button onClick={onToggleSound} className="rounded border border-white/15 px-2 py-0.5 text-white/50 hover:text-white/80">
          {soundOn ? '🔊' : '🔇'}
        </button>
        <button onClick={onTogglePause} className="rounded border border-white/15 px-2 py-0.5 text-white/50 hover:text-white/80">
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
      </div>
    </div>
  );
}

function ResultCard({ result, best }: { result: RunResult; best: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-center justify-center bg-black/75"
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="rounded-lg border border-white/15 bg-[#0b0024]/95 px-8 py-6 text-center"
      >
        <p className="glow-red text-lg font-bold tracking-[0.25em] text-red-400">JEV CRASHED</p>
        <div className="mt-4 grid grid-cols-3 gap-6 text-sm">
          <Figure label="score" value={result.score.toLocaleString()} />
          <Figure label="metres" value={String(result.distance)} />
          <Figure label="coins" value={String(result.coins)} />
        </div>
        {result.score >= best && best > 0 && (
          <p className="mt-3 text-[11px] tracking-wider text-cyan-300">its best run yet</p>
        )}
        <p className="mt-4 text-[11px] text-white/35">going again…</p>
      </motion.div>
    </motion.div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/35">{label}</p>
      <p className="mt-0.5 font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}
