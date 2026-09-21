// ─────────────────────────────────────────────────────────────────────────────
// app/watch/page.tsx  –  /watch — Jev plays, you watch
//
// The human game at `/` is untouched. This is a separate route with a separate
// composition; the only thing the two share is the game itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import JevScene from '@/components/jev/JevScene';

export const metadata: Metadata = {
  title: 'Jev plays Temple Run',
  description:
    "TypeSafe AI's System One model playing an endless runner live, on structured game state rather than pixels.",
};

export default function WatchPage() {
  return <JevScene />;
}
