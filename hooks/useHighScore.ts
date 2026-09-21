// ─────────────────────────────────────────────────────────────────────────────
// hooks/useHighScore.ts  –  localStorage-backed high score per difficulty
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import type { Difficulty } from '../types/game';

const KEY = (d: Difficulty) => `tr_highscore_${d}`;

export function useHighScore(difficulty: Difficulty): {
  highScore: number;
  saveHighScore: (score: number) => void;
} {
  const [highScore, setHighScore] = useState(0);

  // Read after mount, never during the first render. The server has no
  // localStorage, so seeding the initial render from it makes the markup React
  // hydrates disagree with the markup it was given — which is the hydration
  // warning behind the dev overlay's "1 Issue" badge.
  useEffect(() => {
    setHighScore(readScore(difficulty));
  }, [difficulty]);

  const saveHighScore = useCallback((score: number) => {
    const rounded = Math.floor(score);
    setHighScore(prev => {
      const next = Math.max(prev, rounded);
      if (typeof window !== 'undefined') {
        localStorage.setItem(KEY(difficulty), String(next));
      }
      return next;
    });
  }, [difficulty]);

  return { highScore, saveHighScore };
}

function readScore(difficulty: Difficulty): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem(KEY(difficulty)) ?? '0', 10) || 0;
}

/** Read all three difficulty high scores. Browser-only; see `useAllHighScores`. */
export function getAllHighScores(): Record<Difficulty, number> {
  return { easy: readScore('easy'), medium: readScore('medium'), hard: readScore('hard') };
}

/** All three scores, read after mount so they are safe to render. */
export function useAllHighScores(): {
  highScores: Record<Difficulty, number>;
  refresh: () => void;
} {
  const [highScores, setHighScores] = useState<Record<Difficulty, number>>(
    { easy: 0, medium: 0, hard: 0 },
  );
  const refresh = useCallback(() => setHighScores(getAllHighScores()), []);
  useEffect(refresh, [refresh]);
  return { highScores, refresh };
}
