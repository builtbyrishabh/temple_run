// ─────────────────────────────────────────────────────────────────────────────
// lib/utils.ts  –  Pure math helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Smooth-step easing */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Random integer in [lo, hi] */
export function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Pick a random element */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
