import { SEVERITIES, SEVERITY_GLYPH, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';
import { SEVERITY_LABEL } from './Glyph.js';

export interface SummaryStripProps {
  buildLabel: string;
  stackCount: number;
  evaluatedCount: number;
  resourceCount: number;
  counts: Record<Severity, number>;
  active: ReadonlySet<Severity>;
  onToggle: (severity: Severity) => void;
}

/**
 * Counts across the estate, and the severity filter — one control, not two.
 *
 * Rungs render most-severe first, which is the order the reader cares about.
 * A rung with zero rows still renders: "0 destructive" is the answer to the
 * question people open this tab to ask, and hiding it would leave that answer
 * to be inferred from an absence.
 */
export function SummaryStrip(props: SummaryStripProps): React.ReactElement {
  const rungs = [...SEVERITIES].reverse();
  const notEvaluated = props.stackCount - props.evaluatedCount;

  return (
    <div className="strip">
      <div className="strip__meta">
        <span>
          <b>{props.stackCount}</b> {props.stackCount === 1 ? 'stack' : 'stacks'}
        </span>
        {notEvaluated > 0 && (
          <>
            <span className="strip__sep">·</span>
            <span>
              <b>{notEvaluated}</b> without results
            </span>
          </>
        )}
        <span className="strip__sep">·</span>
        <span>
          <b>{props.resourceCount}</b> {props.resourceCount === 1 ? 'resource' : 'resources'}
        </span>
        <span className="strip__sep">·</span>
        <span>{props.buildLabel}</span>
      </div>

      <div className="strip__chips" role="group" aria-label="Filter by severity">
        {rungs.map((severity) => {
          const count = props.counts[severity] ?? 0;
          const on = props.active.has(severity);
          return (
            <button
              key={severity}
              type="button"
              className="chip"
              data-on={on}
              data-tone={SEVERITY_TONE[severity]}
              data-empty={count === 0}
              aria-pressed={on}
              onClick={() => {
                props.onToggle(severity);
              }}
            >
              <span className="chip__glyph" aria-hidden="true">
                {SEVERITY_GLYPH[severity]}
              </span>
              <span className="chip__count">{count}</span>
              <span className="chip__label">{SEVERITY_LABEL[severity]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
