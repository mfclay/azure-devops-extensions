import { SEVERITIES, SEVERITY_RANK, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';
import { SEVERITY_LABEL } from './Glyph.js';

export interface TotalsProps {
  counts: Record<Severity, number>;
  /** How many of each rung's rows Azure marked potential. Shown only where non-zero. */
  potentialCounts?: Record<Severity, number> | undefined;
  active: ReadonlySet<Severity>;
  onToggle: (severity: Severity) => void;
}

/**
 * Counts across the estate, and the severity filter: one control, so the count
 * and the filter cannot disagree.
 *
 * Plain words with the colour on the number only, and only where the rung is
 * one people look for (destructive, protection loss, new). The chips this
 * replaced said each count three times over (glyph, coloured number, coloured
 * word, inside a coloured border). A rung with no rows is left out; the
 * headline above states the answer a zero would have implied.
 */
export function Totals(props: TotalsProps): React.ReactElement | null {
  const rungs = [...SEVERITIES].reverse().filter((s) => (props.counts[s] ?? 0) > 0);
  if (rungs.length === 0) return null;

  return (
    <div className="totals" role="group" aria-label="Filter by severity">
      {/* The headline counts stacks; these count resources. Said, so the two aren't read as one. */}
      <span className="totals__label">Resources</span>
      {rungs.map((severity) => {
        const count = props.counts[severity];
        const potential = props.potentialCounts?.[severity] ?? 0;
        const on = props.active.has(severity);
        return (
          <button
            key={severity}
            type="button"
            className="total"
            data-on={on}
            aria-pressed={on}
            title={on ? `Hide ${SEVERITY_LABEL[severity]}` : `Show ${SEVERITY_LABEL[severity]}`}
            onClick={() => {
              props.onToggle(severity);
            }}
          >
            <b
              className="total__count"
              data-tone={SEVERITY_RANK[severity] >= SEVERITY_RANK.create ? SEVERITY_TONE[severity] : undefined}
            >
              {count}
            </b>{' '}
            {SEVERITY_LABEL[severity]}
            {potential > 0 && <span className="total__sub">, {potential} potential</span>}
          </button>
        );
      })}
    </div>
  );
}
