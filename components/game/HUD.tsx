'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/game/HUD.tsx  –  Score / distance / coins overlay
// ─────────────────────────────────────────────────────────────────────────────

import { motion } from 'framer-motion';
import { INITIAL_SPEED, MAX_SPEED } from '@/lib/constants';

interface Props {
  score:      number;
  distance:   number;
  coins:      number;
  highScore:  number;
  speed:      number;
}

export default function HUD({ score, distance, coins, highScore, speed }: Props) {
  const pct = Math.min(1, (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED)); // 0 = slow, 1 = max speed

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Scrim. The scene behind is bright daylight, and the readout used to be
          white text on a white sky — unreadable in exactly the frames that
          matter. */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b
                      from-black/60 via-black/25 to-transparent" />

      {/* ── Top bar ── */}
      <div className="relative flex items-start justify-between gap-2 p-4 sm:p-5">
        {/* Score, with the speed ramp tucked under it rather than spanning the scene */}
        <div className="flex w-28 flex-col sm:w-40">
          <span className="text-[10px] uppercase tracking-widest text-white/60">Score</span>
          <span className="text-xl sm:text-2xl font-semibold tabular-nums text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {Math.floor(score).toLocaleString()}
          </span>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#d4ebc0] to-[#e8bc7a]"
              animate={{ width: `${pct * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#e8d5b8]">
            {pct < 0.15 ? 'Warming up' : pct < 0.45 ? 'Picking up pace' : pct < 0.8 ? 'Under pressure' : 'Endgame'}
          </span>
          {highScore > 0 && (
            <span className="mt-1 text-[10px] text-cyan-200/70">
              Best {highScore.toLocaleString()}
            </span>
          )}
        </div>

        {/* Coins */}
        <div className="flex items-center gap-1.5 rounded-full border border-yellow-300/40
                        bg-black/45 px-3 py-1 backdrop-blur-sm">
          <span className="text-yellow-300 drop-shadow-[0_0_6px_#ffe600]">◈</span>
          <span className="text-sm font-bold text-yellow-100">{coins}</span>
        </div>

        {/* Distance */}
        <div className="flex w-28 flex-col sm:w-40 items-end">
          <span className="text-[10px] uppercase tracking-widest text-white/60">Distance</span>
          <span className="text-xl sm:text-2xl font-semibold tabular-nums text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {distance.toFixed(0)}m
          </span>
        </div>
      </div>
    </div>
  );
}
