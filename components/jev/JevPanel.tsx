'use client';

import type { JevStatus } from '@/hooks/useJevDriver';
import { INITIAL_SPEED, MAX_SPEED } from '@/lib/constants';
import { RUNNER_ACTIONS, type RunnerAction, type Sensors } from '@/lib/jev/contract';

const ACTIONS: Record<RunnerAction, { label: string; symbol: string; color: string; outcome: keyof Sensors }> = {
  left: { label: 'Step left', symbol: '←', color: '#9edee5', outcome: 'ifItStepsLeft' },
  right: { label: 'Step right', symbol: '→', color: '#9edee5', outcome: 'ifItStepsRight' },
  jump: { label: 'Jump', symbol: '↑', color: '#d1bbff', outcome: 'ifItJumps' },
  slide: { label: 'Slide', symbol: '↓', color: '#ffc987', outcome: 'ifItSlides' },
  none: { label: 'Hold course', symbol: '↟', color: '#b9dfb0', outcome: 'ifItDoesNothing' },
};

interface Props {
  status: JevStatus;
  speed: number;
  paused: boolean;
  finished: boolean;
}

/** Spectator display: only observed decisions and game progress, never controls. */
export default function JevPanel({ status, speed, paused, finished }: Props) {
  const { decision, sensors } = status;
  const action = decision ? ACTIONS[decision.action] : null;
  const progress = Math.max(0, Math.min(1, (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED)));
  const phase = progress < 0.15 ? 'Warming up' : progress < 0.45 ? 'Finding a rhythm' : progress < 0.8 ? 'Under pressure' : 'Endgame';
  const session = paused ? 'Paused' : finished ? 'Run complete' : decision?.live === false ? 'Offline demo' : decision ? 'Live model' : 'Connecting';

  return (
    <aside className="spectator-panel">
      <header className="spectator-header">
        <div className="spectator-brand"><span className="jev-monogram">j.</span><div><h2>Jev on the run</h2><p>AN AI AT THE CONTROLS</p></div></div>
        <span className={`session-tag ${decision?.live === false ? 'is-mock' : ''}`}><i />{session}</span>
      </header>

      <section className="decision-hero" style={{ '--decision-color': action?.color ?? '#b9dfb0' } as React.CSSProperties}>
        <div className="panel-eyebrow"><span>LATEST DECISION</span><span className="font-mono">{String(status.decisions).padStart(3, '0')}</span></div>
        <div className="decision-title"><span className="decision-symbol" aria-hidden="true">{action?.symbol ?? '·'}</span><h3>{action?.label ?? 'Eyes ahead'}</h3></div>
        <p className="decision-reason">{decision && sensors ? sensors[ACTIONS[decision.action].outcome] : 'Waiting for the first obstacle. Every move is chosen live.'}</p>
      </section>

      <section className="response-strip" aria-label="Model response time">
        <div><span className="panel-eyebrow">RESPONSE TIME</span><p>{decision?.latencyMs ?? '—'}<span> ms</span></p></div>
        <svg viewBox="0 0 104 34" className="response-wave" aria-hidden="true"><path d="M0 19 H18 L24 13 L32 25 L43 3 L54 31 L62 15 L69 19 H104" /></svg>
      </section>

      <section className="run-pressure">
        <div className="panel-eyebrow"><span>THE PACE</span><span>{Math.round(progress * 100)}%</span></div>
        <div className="pressure-bars" aria-label={`Speed ramp ${Math.round(progress * 100)} percent`}>
          {Array.from({ length: 20 }, (_, i) => <span key={i} className={i / 20 < progress ? 'is-filled' : ''} />)}
        </div>
        <div className="pressure-caption"><strong>{phase}</strong><span>{(speed / INITIAL_SPEED).toFixed(1)}× speed</span></div>
      </section>

      {decision?.probabilities && (
        <section className="decision-options">
          <div className="panel-eyebrow"><span>WEIGHING THE MOVES</span></div>
          <div className="option-grid">
            {RUNNER_ACTIONS.map(key => {
              const probability = Math.max(0, Math.min(1, decision.probabilities?.[key] ?? 0));
              return <div key={key} className={`move-option ${key === decision.action ? 'is-chosen' : ''}`}>
                <span className="option-symbol" aria-hidden="true">{ACTIONS[key].symbol}</span>
                <span className="option-name">{key === 'none' ? 'hold' : key}</span>
                <span className="option-bar"><span style={{ height: `${probability * 100}%` }} /></span>
                <span className="option-value">{Math.round(probability * 100)}%</span>
              </div>;
            })}
          </div>
        </section>
      )}

      <details className="decision-details">
        <summary>What Jev sees <span>+</span></summary>
        <p>Structured game state, sent to the model before each decision.</p>
        <dl>
          <dt>Position</dt><dd>{sensors?.stance ?? '—'}</dd>
          <dt>Next obstacle</dt><dd>{sensors?.threatIn ?? '—'}</dd>
          {RUNNER_ACTIONS.map(key => <div key={key}><dt>{ACTIONS[key].label}</dt><dd>{sensors?.[ACTIONS[key].outcome] ?? '—'}</dd></div>)}
          <dt>Model</dt><dd>{decision?.model ?? 'typesafe-ai/jev'}</dd>
          <dt>Input tokens</dt><dd>{status.inputTokens.toLocaleString()}</dd>
        </dl>
      </details>

      {status.error && <p role="alert" className="panel-error">{status.error}</p>}
      <footer className="spectator-footer"><span>FIVE MOVES. ONE SHOT.</span><span>JEV / 01</span></footer>
    </aside>
  );
}
