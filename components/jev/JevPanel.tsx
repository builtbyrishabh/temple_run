'use client';
// ─────────────────────────────────────────────────────────────────────────────
// components/jev/JevPanel.tsx  –  What Jev saw, and what it decided
//
// Pure presentation. It reads the control layer's status and renders it; it has
// no say in the run.
// ─────────────────────────────────────────────────────────────────────────────

import { motion } from 'framer-motion';
import { type JevStatus } from '@/hooks/useJevDriver';
import { DECISION_INTERVAL_MS } from '@/lib/jev/timing';
import { RUNNER_ACTIONS, type RunnerAction } from '@/lib/jev/contract';
import type { Sensors } from '@/lib/jev/contract';

/** Jev's gateway list price per input token. Its output tokens are free. */
const COST_PER_INPUT_TOKEN = 0.000000042;

const ACTION_LABEL: Record<RunnerAction, string> = {
  left: '◀  STEP LEFT',
  right: 'STEP RIGHT  ▶',
  jump: '▲  JUMP',
  slide: '▼  SLIDE',
  none: '●  HOLD THE LANE',
};

const ACTION_COLOR: Record<RunnerAction, string> = {
  left: '#00e5ff',
  right: '#00e5ff',
  jump: '#aa44ff',
  slide: '#ff9500',
  none: '#7dd3a0',
};

/** The sensor fields, in the order they read as a situation. */
const SENSOR_ROWS: { key: keyof Sensors; label: string }[] = [
  { key: 'stance', label: 'stance' },
  { key: 'threatIn', label: 'threat in' },
  { key: 'ifItDoesNothing', label: 'if it holds' },
  { key: 'ifItStepsLeft', label: 'if it steps left' },
  { key: 'ifItStepsRight', label: 'if it steps right' },
  { key: 'ifItJumps', label: 'if it jumps' },
  { key: 'ifItSlides', label: 'if it slides' },
  { key: 'turnGate', label: 'turn gate' },
];

export default function JevPanel({ status }: { status: JevStatus }) {
  const { decision, sensors, awaiting, inFlight } = status;
  const live = decision?.live ?? null;
  const cost = status.inputTokens * COST_PER_INPUT_TOKEN;

  return (
    <aside className="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#07001a]/90 p-4 text-[11px] leading-relaxed backdrop-blur-sm">

      {/* ── Who is playing ── */}
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="glow-cyan text-sm font-bold tracking-[0.2em] text-cyan-300">
            JEV IS PLAYING
          </h2>
          <p className="mt-0.5 text-white/40">
            {decision?.model ?? 'typesafe-ai/jev'} · via Vercel AI Gateway
          </p>
        </div>
        <Badge live={live} />
      </header>

      {/* ── The decision ── */}
      <section className="rounded border border-white/10 bg-black/40 p-3">
        <Label>decision</Label>
        {decision ? (
          <>
            <motion.div
              key={`${decision.action}-${status.decisions}`}
              initial={{ opacity: 0.4, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-1 text-base font-bold tracking-wider"
              style={{ color: ACTION_COLOR[decision.action], textShadow: `0 0 12px ${ACTION_COLOR[decision.action]}` }}
            >
              {ACTION_LABEL[decision.action]}
            </motion.div>
            <p className="mt-1 h-4 text-white/40">
              {awaiting && awaiting !== 'none'
                ? 'held until the frame it can land on'
                : 'pressed'}
            </p>
            <Distribution probabilities={decision.probabilities} chosen={decision.action} />
          </>
        ) : (
          <p className="mt-1 text-white/40">waiting for the first threat…</p>
        )}
      </section>

      {/* ── Danger read ── */}
      <section className="rounded border border-white/10 bg-black/40 p-3">
        <Label>danger read</Label>
        {decision ? (
          <div className="mt-1.5 flex items-center gap-2">
            <Meter value={decision.danger.score / 2} color="#ff2f5e" />
            <span className="w-24 shrink-0 text-white/70">
              {decision.danger.score.toFixed(2)} · {decision.danger.label}
            </span>
          </div>
        ) : (
          <p className="mt-1 text-white/40">—</p>
        )}
        <p className="mt-1.5 text-white/30">
          A separate question, shown only here. It never touches the controls.
        </p>
      </section>

      {/* ── Loop telemetry ── */}
      <section className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded border border-white/10 bg-black/40 p-3">
        <Stat label="round trip" value={decision ? `${decision.latencyMs} ms` : '—'} />
        <Stat label="in flight" value={inFlight ? 'yes' : 'no'} />
        <Stat label="decisions" value={String(status.decisions)} />
        <Stat label="input tokens" value={status.inputTokens.toLocaleString()} />
        <Stat label="spent" value={live === false ? '$0.00' : `$${cost.toFixed(4)}`} />
        <Stat label="cadence" value={`${DECISION_INTERVAL_MS} ms`} />
      </section>

      {/* ── What Jev sees ── */}
      <section className="rounded border border-white/10 bg-black/40 p-3">
        <Label>what jev sees</Label>
        <p className="mt-1 text-white/30">
          Not pixels. Every line is the consequence of one move, already measured
          from the runner.
        </p>
        <dl className="mt-2 space-y-1.5">
          {SENSOR_ROWS.map(({ key, label }) => (
            <div key={key}>
              <dt className="text-[10px] uppercase tracking-wider text-cyan-300/50">{label}</dt>
              <dd className="text-white/70">{sensors ? String(sensors[key]) : '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {status.error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-300">
          {status.error}
        </p>
      )}
    </aside>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.2em] text-white/35">{children}</span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-white/35">{label}</span>
      <span className="font-bold text-white/80">{value}</span>
    </div>
  );
}

function Badge({ live }: { live: boolean | null }) {
  if (live === null) {
    return <span className="shrink-0 rounded border border-white/20 px-2 py-0.5 text-[10px] text-white/40">…</span>;
  }
  return live ? (
    <span className="shrink-0 rounded border border-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-300">
      ● LIVE
    </span>
  ) : (
    <span className="shrink-0 rounded border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-300">
      MOCK
    </span>
  );
}

function Meter({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <motion.div
        className="h-full rounded-full"
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.15 }}
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

/**
 * Jev returns a probability for every option, not just the winner, so the panel
 * shows the whole distribution — a 40/38 split and a 97/1 split are very
 * different runs, and only one of them looks decisive.
 */
function Distribution({
  probabilities, chosen,
}: {
  probabilities?: Partial<Record<RunnerAction, number>>;
  chosen: RunnerAction;
}) {
  if (!probabilities) return null;

  return (
    <div className="mt-3 space-y-1">
      {RUNNER_ACTIONS.map(action => {
        const p = probabilities[action] ?? 0;
        const isChosen = action === chosen;
        return (
          <div key={action} className="flex items-center gap-2">
            <span className={`w-10 shrink-0 ${isChosen ? 'text-white/80' : 'text-white/35'}`}>
              {action}
            </span>
            <Meter value={p} color={isChosen ? ACTION_COLOR[action] : '#ffffff40'} />
            <span className={`w-9 shrink-0 text-right tabular-nums ${isChosen ? 'text-white/80' : 'text-white/35'}`}>
              {Math.round(p * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
