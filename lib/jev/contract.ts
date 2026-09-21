// ─────────────────────────────────────────────────────────────────────────────
// lib/jev/contract.ts  –  The vocabulary shared by every layer
//
// This file is the seam. The sensing layer produces `Sensors`, the decision
// layer (server) turns one into a `Decision`, and the control layer turns that
// into button presses. Nothing else crosses between them.
// ─────────────────────────────────────────────────────────────────────────────

/** The five things a runner can do. Exactly the options of Jev's `action` question. */
export type RunnerAction = 'left' | 'right' | 'jump' | 'slide' | 'none';

export const RUNNER_ACTIONS: readonly RunnerAction[] = [
  'left', 'right', 'jump', 'slide', 'none',
] as const;

/**
 * One snapshot of the corridor, as Jev sees it.
 *
 * Every field is pre-computed by the game and phrased as *the consequence of an
 * action the runner could take right now*, so the five `ifIt…` fields line up
 * one-to-one with the five options of the `action` question. Jev never has to
 * subtract a coordinate, resolve a lane index, or decide whether "+" means left
 * or right — it only has to judge which sentence reads best.
 *
 * Kept deliberately small: large states with irrelevant detail measurably
 * degrade Jev's answers.
 */
export interface Sensors {
  /** What the runner is doing at this instant, as a phrase rather than an enum. */
  stance: string;
  /** How long until the next thing that can hurt it, or that nothing is in reach. */
  threatIn: string;
  /** Outcome of holding the current lane and not jumping or sliding. */
  ifItDoesNothing: string;
  /** Outcome of stepping one lane left. */
  ifItStepsLeft: string;
  /** Outcome of stepping one lane right. */
  ifItStepsRight: string;
  /** Outcome of jumping now. */
  ifItJumps: string;
  /** Outcome of sliding now. */
  ifItSlides: string;
}

/** What Jev decided, plus the metadata the scene shows while it plays. */
export interface Decision {
  /** The action Jev chose. This is the entire control input. */
  action: RunnerAction;
  /** Jev's probability for each option, when it reports a distribution. */
  probabilities?: Partial<Record<RunnerAction, number>>;
  /** Danger read on the 0..2 rubric, for the panel only. Never used to play. */
  danger: { score: number; label: string };
  /** Round-trip time for the call, measured on the server. */
  latencyMs: number;
  /** Input tokens billed for this decision. Jev's output tokens are free. */
  inputTokens: number;
  /** Model that answered, e.g. "typesafe-ai/jev" — or "offline-stand-in". */
  model: string;
  /** False when the built-in offline stand-in answered instead of Jev. */
  live: boolean;
}

/** Request body of `POST /api/jev`. */
export interface DecideRequest {
  sensors: Sensors;
}
