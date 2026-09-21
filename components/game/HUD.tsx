'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/game/HUD.tsx  –  Score / distance / coins overlay
// ─────────────────────────────────────────────────────────────────────────────

import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  score:      number;
  distance:   number;
  coins:      number;
  highScore:  number;
  multiplier: number;
  speed:      number;
}

export default function HUD({ score, distance, coins, highScore, multiplier, speed }: Props) {
  const pct = Math.min(1, (speed - 8) / 22); // 0 = slow, 1 = max speed

  return (
    <div className="absolute inset-0 pointer-events-none font-mono">
      {/* Scrim. The scene behind is bright daylight, and the readout used to be
          white text on a white sky — unreadable in exactly the frames that
          matter. */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b
                      from-black/60 via-black/25 to-transparent" />

      {/* ── Top bar ── */}
      <div className="relative flex items-start justify-between gap-2 p-3">
        {/* Score, with the speed ramp tucked under it rather than spanning the scene */}
        <div className="flex w-40 flex-col">
          <span className="text-[10px] uppercase tracking-widest text-white/60">Score</span>
          <span className="text-xl font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {Math.floor(score).toLocaleString()}
          </span>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-purple-400"
              animate={{ width: `${pct * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          {highScore > 0 && (
            <span className="mt-1 text-[10px] text-cyan-200/70">
              Best {highScore.toLocaleString()}
            </span>
          )}
        </div>

        {/* Coins and the multiplier, stacked down the centre */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full border border-yellow-300/40
                          bg-black/45 px-3 py-1 backdrop-blur-sm">
            <span className="text-yellow-300 drop-shadow-[0_0_6px_#ffe600]">◈</span>
            <span className="text-sm font-bold text-yellow-100">{coins}</span>
          </div>

          <AnimatePresence>
            {multiplier > 1 && (
              <motion.div
                key={multiplier}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                className="rounded-lg border border-purple-300/60 bg-purple-600/70 px-2 py-0.5
                           text-sm font-bold text-purple-100 backdrop-blur-sm"
              >
                ×{multiplier.toFixed(1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Distance */}
        <div className="flex w-40 flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-white/60">Distance</span>
          <span className="text-xl font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {distance.toFixed(0)}m
          </span>
        </div>
      </div>
    </div>
  );
}
