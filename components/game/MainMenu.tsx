'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/game/MainMenu.tsx  –  Animated start screen
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAllHighScores } from '@/hooks/useHighScore';
import type { Difficulty } from '@/types/game';

interface Props {
  onStart: (difficulty: Difficulty) => void;
  soundOn: boolean;
  onToggleSound: () => void;
}

const DIFFICULTIES: { id: Difficulty; label: string; desc: string; color: string }[] = [
  { id: 'easy',   label: 'EASY',   desc: 'Comfortable pace',   color: 'from-green-500  to-cyan-500'  },
  { id: 'medium', label: 'MEDIUM', desc: 'Ramped-up speed',    color: 'from-yellow-500 to-orange-500' },
  { id: 'hard',   label: 'HARD',   desc: 'Maximum intensity',  color: 'from-red-500    to-pink-500'  },
];

export default function MainMenu({ onStart, soundOn, onToggleSound }: Props) {
  const [selected, setSelected] = useState<Difficulty>('medium');
  const { highScores: scores } = useAllHighScores();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center
                    bg-gradient-to-b from-[#060014] via-[#0d0030] to-[#18005c]
                    overflow-hidden">

      {/* Animated neon grid lines */}
      <NeonGrid />

      {/* Title */}
      <motion.div
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0,   opacity: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 14 }}
        className="relative z-10 text-center mb-8"
      >
        <h1 className="text-5xl md:text-7xl font-black tracking-tight
                       text-transparent bg-clip-text
                       bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400
                       drop-shadow-[0_0_30px_rgba(120,0,255,0.8)]">
          TEMPLE RUN
        </h1>
        <p className="text-cyan-300/70 text-sm tracking-[0.3em] uppercase mt-1 font-mono">
          Neon Endless Runner
        </p>
      </motion.div>

      {/* Controls hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="relative z-10 mb-6 grid grid-cols-2 gap-2 text-xs font-mono
                   text-white/50 text-center"
      >
        <span className="bg-white/5 border border-white/10 rounded px-3 py-1">
          ← → Change lane
        </span>
        <span className="bg-white/5 border border-white/10 rounded px-3 py-1">
          ↑ / Space  Jump
        </span>
        <span className="bg-white/5 border border-white/10 rounded px-3 py-1">
          ↓ Slide
        </span>
        <span className="bg-white/5 border border-white/10 rounded px-3 py-1">
          P / Esc  Pause
        </span>
      </motion.div>

      {/* Difficulty selector */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="relative z-10 flex flex-col gap-3 w-64 mb-8"
      >
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            onClick={() => setSelected(d.id)}
            className={`
              relative rounded-xl border-2 px-4 py-3 font-mono text-left
              transition-all duration-200 overflow-hidden
              ${selected === d.id
                ? 'border-white/70 bg-white/10 scale-105 shadow-[0_0_20px_rgba(120,0,255,0.5)]'
                : 'border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/8'}
            `}
          >
            {selected === d.id && (
              <div className={`absolute inset-0 bg-gradient-to-r ${d.color} opacity-10`} />
            )}
            <div className="flex justify-between items-center">
              <span className={`font-bold text-sm ${selected === d.id ? 'text-white' : 'text-white/60'}`}>
                {d.label}
              </span>
              {scores[d.id] > 0 && (
                <span className="text-yellow-400/70 text-xs">
                  ◈ {scores[d.id].toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-white/40 text-xs mt-0.5">{d.desc}</p>
          </button>
        ))}
      </motion.div>

      {/* Start button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => onStart(selected)}
        className="relative z-10 px-10 py-4 rounded-2xl font-black text-xl tracking-widest
                   bg-gradient-to-r from-cyan-500 to-purple-600
                   text-white shadow-[0_0_30px_rgba(0,200,255,0.4)]
                   hover:shadow-[0_0_50px_rgba(0,200,255,0.6)]
                   transition-shadow duration-300"
      >
        ▶ RUN
      </motion.button>

      {/* Sound toggle */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        onClick={onToggleSound}
        className="relative z-10 mt-4 text-white/40 hover:text-white/70
                   text-xs font-mono transition-colors flex items-center gap-1.5"
      >
        {soundOn ? '🔊 Sound ON' : '🔇 Sound OFF'}
      </motion.button>

      {/* Watch Jev play instead */}
      <motion.a
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        href="/watch"
        className="relative z-10 mt-6 text-cyan-300/60 hover:text-cyan-300
                   text-xs font-mono tracking-wider transition-colors
                   border-b border-cyan-300/20 hover:border-cyan-300/60 pb-0.5"
      >
        or watch Jev play it →
      </motion.a>
    </div>
  );
}

// ── Animated neon grid background ─────────────────────────────────────────────

function NeonGrid() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6600ff" stopOpacity="0" />
          <stop offset="60%" stopColor="#6600ff" stopOpacity="1" />
          <stop offset="100%" stopColor="#6600ff" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Converging grid lines toward centre-bottom vanishing point */}
      {[-8,-5,-3,-1,0,1,3,5,8].map((x, i) => (
        <line
          key={i}
          x1={`${50 + x * 6}%`} y1="100%"
          x2="50%" y2="45%"
          stroke="url(#vg)" strokeWidth="1"
        />
      ))}
      {[0.5,0.55,0.6,0.65,0.7,0.75,0.82,0.9,1].map((y, i) => (
        <line
          key={i}
          x1="0%" y1={`${y * 100}%`}
          x2="100%" y2={`${y * 100}%`}
          stroke="#6600ff" strokeWidth="0.5" strokeOpacity={0.4 - i * 0.03}
        />
      ))}
    </svg>
  );
}
