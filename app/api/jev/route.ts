// ─────────────────────────────────────────────────────────────────────────────
// app/api/jev/route.ts  –  The boundary between the browser and Jev
//
// The only reason this exists is that `AI_GATEWAY_API_KEY` must not reach the
// browser. It validates the shape it was handed, calls the decision layer, and
// returns the answer verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { decide } from '@/lib/jev/pilot';
import type { Sensors } from '@/lib/jev/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUIRED: readonly (keyof Sensors)[] = [
  'stance', 'threatIn', 'ifItDoesNothing', 'ifItStepsLeft', 'ifItStepsRight',
  'ifItJumps', 'ifItSlides', 'turnGate',
];

export async function POST(request: Request) {
  let sensors: unknown;
  try {
    ({ sensors } = await request.json());
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  if (!isSensors(sensors)) {
    return NextResponse.json({ error: 'malformed sensor payload' }, { status: 400 });
  }

  try {
    return NextResponse.json(await decide(sensors));
  } catch (error) {
    // A dropped decision is survivable — the runner holds its last commitment
    // and the loop asks again on the next tick — so this only needs reporting.
    const message = error instanceof Error ? error.message : 'decision failed';
    console.error('[jev] decision failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Cheap shape check, so nothing malformed is ever forwarded to a metered API. */
function isSensors(value: unknown): value is Sensors {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED.every(key => typeof candidate[key] === 'string');
}
