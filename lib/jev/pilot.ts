// ─────────────────────────────────────────────────────────────────────────────
// lib/jev/pilot.ts  –  One corridor snapshot → one decision
//
// Server-only. Jev is reached through the Vercel AI SDK's evaluation interface,
// routed by the AI Gateway, so `AI_GATEWAY_API_KEY` never reaches the browser.
//
// Jev is asked exactly two questions per snapshot, in a single request:
//
//   · `action` (choice) — the control input. This is the whole decision.
//   · `danger` (score)  — a read on the situation, for the panel only.
//
// They are deliberately different questions. Nothing here corrects, smooths or
// vetoes the answer: whichever option Jev names is the button that gets pressed.
// ─────────────────────────────────────────────────────────────────────────────

import { gateway } from '@ai-sdk/gateway';
import { experimental_evaluate as evaluate } from 'ai';
import type { Decision, RunnerAction, Sensors } from './contract';
import { RUNNER_ACTIONS } from './contract';

const JEV_MODEL_ID = 'typesafe-ai/jev';

/**
 * A decision that arrives late is worse than one that never arrives — the game
 * simply asks again on the next tick — so retries are off and the timeout sits
 * just past the slowest answer measured against this model (378–608ms over a
 * sample of live calls), rather than at a round number pulled from the air.
 */
const TIMEOUT_MS = 1500;

/** Index 0 is safest. The answer may land between levels. */
const DANGER_RUBRIC = [
  'Safe — the lane ahead is clear and nothing is closing in.',
  'Tight — something is coming that needs the right move, and there is just time to make it.',
  'Critical — it is hit within about a second unless it moves now.',
] as const;

/**
 * The five options are worded as the *move*, not the destination, and match the
 * five `ifIt…` fields of the state one-to-one — so choosing is a matter of
 * reading the consequences, never of working out where a lane index leads.
 */
const questions = {
  action: {
    type: 'choice',
    instructions: [
      'A runner is sprinting down a three-lane temple corridor that never ends.',
      'It can step one lane sideways, jump, slide, or do nothing, and it may only do one of those.',
      'The state spells out what happens for each of those five moves; pick the one that keeps the runner alive.',
      'Staying alive comes first, coins a distant second.',
    ].join(' '),
    criteria: {
      left: 'Step one lane to the left. The state calls this "ifItStepsLeft".',
      right: 'Step one lane to the right. The state calls this "ifItStepsRight".',
      jump: 'Jump. The state calls this "ifItJumps".',
      slide: 'Drop into a slide. The state calls this "ifItSlides".',
      none: 'Hold the current lane and keep running. The state calls this "ifItDoesNothing".',
    },
  },
  danger: {
    type: 'score',
    instructions: 'How close is this runner to being hit right now?',
    criteria: DANGER_RUBRIC,
  },
} as const;

/** True when a gateway key is configured, so decisions come from Jev itself. */
function isLive(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

/** Ask Jev what to do about one corridor snapshot. */
export async function decide(sensors: Sensors): Promise<Decision> {
  if (!isLive()) return standIn(sensors);

  const startedAt = performance.now();
  const result = await evaluate({
    model: gateway.evaluationModel(JEV_MODEL_ID),
    state: { ...sensors },
    questions,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const latencyMs = Math.round(performance.now() - startedAt);

  const { action, danger } = result.answers;

  return {
    action: action.choice,
    probabilities: action.probabilities,
    danger: { score: danger.score, label: rubricLabel(danger.score) },
    latencyMs,
    inputTokens: result.usage.inputTokens ?? 0,
    model: result.response.modelId || JEV_MODEL_ID,
    live: true,
  };
}

/** Short name of the rubric level nearest an expected score. */
function rubricLabel(score: number): string {
  const index = Math.min(DANGER_RUBRIC.length - 1, Math.max(0, Math.round(score)));
  return DANGER_RUBRIC[index].split(' — ')[0];
}

// ── Offline stand-in ─────────────────────────────────────────────────────────
// Runs only when AI_GATEWAY_API_KEY is unset, so the scene is watchable without
// a key. It is a keyword rule over the same sentences Jev reads — not a model —
// and the panel marks every decision it makes as MOCK. It tells you nothing
// about how Jev plays.

const FATAL = ['not possible', 'too late', 'still hits', 'straight into', 'runs straight into'];
const GOOD = ['is clear', 'clears the', 'passes cleanly'];

async function standIn(sensors: Sensors): Promise<Decision> {
  await new Promise(resolve => setTimeout(resolve, 90));

  const consequences: Record<RunnerAction, string> = {
    left: sensors.ifItStepsLeft,
    right: sensors.ifItStepsRight,
    jump: sensors.ifItJumps,
    slide: sensors.ifItSlides,
    none: sensors.ifItDoesNothing,
  };

  const rank = (text: string): number => {
    const lower = text.toLowerCase();
    if (FATAL.some(f => lower.includes(f))) return -1;
    return GOOD.some(g => lower.includes(g)) ? 1 : 0;
  };

  // Prefer doing nothing on a tie, so the stand-in does not twitch between lanes.
  let best: RunnerAction = 'none';
  for (const option of RUNNER_ACTIONS) {
    if (rank(consequences[option]) > rank(consequences[best])) best = option;
  }

  const doomed = rank(sensors.ifItDoesNothing) < 0;
  const score = doomed ? (sensors.threatIn.includes('third') ? 2 : 1) : 0;

  return {
    action: best,
    danger: { score, label: rubricLabel(score) },
    latencyMs: 90,
    inputTokens: 0,
    model: 'offline-stand-in',
    live: false,
  };
}
