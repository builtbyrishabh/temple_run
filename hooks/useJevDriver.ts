'use client';
// ─────────────────────────────────────────────────────────────────────────────
// hooks/useJevDriver.ts  –  The loop between the corridor and Jev
//
// Two jobs, and only two:
//
//   1. Ask. On a fixed cadence, snapshot the corridor and send it to Jev.
//      Requests are pipelined rather than serial — a strictly serial loop leaves
//      the runner holding a stale answer for a full round trip, which at speed
//      is most of the reaction window. Late answers are dropped by sequence
//      number, so a fresh one is always close behind a slow one.
//
//   2. Press. Turn Jev's chosen action into a button press at the frame it can
//      actually land on. This layer picks *when*, never *what*: a jump held
//      back until the wall is close is still Jev's jump.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSensors } from '@/lib/jev/sensors';
import {
  DECISION_INTERVAL_MS, PRESS_COOLDOWN_FRAMES, TIMED_AGAINST, framesToImpact,
  jumpLead, slideLead,
} from '@/lib/jev/timing';
import type { Decision, RunnerAction, Sensors } from '@/lib/jev/contract';
import type { GameDriver, GameState, InputState } from '@/types/game';

/** What Jev last said, and what the loop is doing with it. */
export interface JevStatus {
  decision: Decision | null;
  /** The snapshot that produced `decision`, so the scene can show both sides. */
  sensors: Sensors | null;
  /** An action Jev has chosen that is waiting for its moment. */
  awaiting: RunnerAction | null;
  inFlight: boolean;
  decisions: number;
  inputTokens: number;
  error: string | null;
}

const IDLE: JevStatus = {
  decision: null, sensors: null, awaiting: null,
  inFlight: false, decisions: 0, inputTokens: 0, error: null,
};

/** An action Jev has chosen, and the wave it was chosen about. */
interface Commitment {
  action: RunnerAction;
  /** Null for a turn-gate answer, which is not timed against an obstacle. */
  worldZ: number | null;
}

export function useJevDriver(active: boolean): { driver: GameDriver; status: JevStatus } {
  const [status, setStatus] = useState<JevStatus>(IDLE);

  // The live game state, refreshed every frame. Held as a ref rather than
  // state because the render loop must not depend on React re-rendering.
  const stateRef = useRef<GameState | null>(null);
  const commitmentRef = useRef<Commitment | null>(null);
  const cooldownRef = useRef(0);
  const seqRef = useRef(0);
  const appliedRef = useRef(0);

  const observe = useCallback((state: Readonly<GameState>) => {
    stateRef.current = state as GameState;
  }, []);

  const consume = useCallback((): Partial<InputState> => {
    if (cooldownRef.current > 0) cooldownRef.current--;

    const commitment = commitmentRef.current;
    const state = stateRef.current;
    if (!commitment || !state || commitment.action === 'none') return {};

    // A sideways step is also how a turn gate is answered, and both want to
    // happen as early as possible — there is nothing to time.
    if (commitment.action === 'left' || commitment.action === 'right') {
      if (cooldownRef.current > 0) return {};
      commitmentRef.current = null;
      cooldownRef.current = PRESS_COOLDOWN_FRAMES;
      return { [commitment.action]: true };
    }

    // A jump or slide only clears an obstacle from part of its arc, so it waits
    // until the wave is the right number of frames out.
    const frames = commitment.worldZ === null
      ? 0
      : framesToImpact(
          commitment.worldZ, state.cameraZ, state.speed, TIMED_AGAINST[commitment.action],
        );

    if (frames < 0) {
      commitmentRef.current = null; // the wave went by; nothing left to answer
      return {};
    }
    const lead = commitment.action === 'jump' ? jumpLead(state.speed) : slideLead(state.speed);
    if (frames > lead) return {};

    commitmentRef.current = null;
    cooldownRef.current = PRESS_COOLDOWN_FRAMES;
    return { [commitment.action === 'jump' ? 'up' : 'down']: true };
  }, []);

  // ── The asking half ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const ask = async () => {
      const state = stateRef.current;
      if (!state || state.status !== 'playing') return;

      const reading = readSensors(state);
      // An empty corridor has nothing to decide. Not asking is both cheaper and
      // more honest than asking a question with one obvious answer.
      if (!reading.worthAsking) {
        commitmentRef.current = null;
        setStatus(prev => (prev.awaiting === null ? prev : { ...prev, awaiting: null }));
        return;
      }

      const seq = ++seqRef.current;
      const askedFromLane = state.player.targetLane;
      setStatus(prev => ({ ...prev, inFlight: true }));

      try {
        const response = await fetch('/api/jev', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sensors: reading.sensors }),
        });
        if (cancelled) return;

        if (!response.ok) {
          const { error } = await response.json().catch(() => ({ error: response.statusText }));
          setStatus(prev => ({ ...prev, inFlight: false, error: String(error) }));
          return;
        }

        const decision: Decision = await response.json();

        // Answers can overtake each other. Only the newest one is worth acting on.
        if (seq <= appliedRef.current) return;
        appliedRef.current = seq;

        // "Step left" means one lane left of wherever the runner was when the
        // question was asked. If it has already moved since — usually because
        // it acted on an earlier answer — the same instruction now points
        // somewhere else entirely, and applying it just makes the runner
        // oscillate. Jumps and slides are absolute, so they are unaffected.
        const lateral = decision.action === 'left' || decision.action === 'right';
        const moved = stateRef.current?.player.targetLane !== askedFromLane;

        commitmentRef.current = decision.action === 'none' || (lateral && moved)
          ? null
          : { action: decision.action, worldZ: reading.threat?.worldZ ?? null };

        setStatus(prev => ({
          decision,
          sensors: reading.sensors,
          awaiting: decision.action === 'none' ? null : decision.action,
          inFlight: false,
          decisions: prev.decisions + 1,
          inputTokens: prev.inputTokens + decision.inputTokens,
          error: null,
        }));
      } catch (error) {
        if (cancelled) return;
        setStatus(prev => ({
          ...prev,
          inFlight: false,
          error: error instanceof Error ? error.message : 'request failed',
        }));
      }
    };

    // Fixed cadence, never awaited — that is what keeps a slow answer from
    // blocking the next one.
    const timer = setInterval(() => { void ask(); }, DECISION_INTERVAL_MS);
    void ask();

    return () => {
      cancelled = true;
      clearInterval(timer);
      commitmentRef.current = null;
    };
  }, [active]);

  const driver = useMemo<GameDriver>(() => ({ observe, consume }), [observe, consume]);

  return { driver, status };
}
