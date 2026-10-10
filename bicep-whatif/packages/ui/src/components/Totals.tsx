import { SEVERITIES, SEVERITY_RANK, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';
import { SEVERITY_LABEL } from './Glyph.js';

export interface TotalsProps {
  counts: Record<Severity, number>;
  /** How many of each rung's rows Azure marked potential. Shown only where non-zero. */
  potentialCounts?: Record<Severity, number> | undefined;
}

/**
 * Counts across the estate. They report and do nothing when clicked: they were
 * once the severity filter too, toggles that hid a kind of change, and read as
 * links that would show it. The filter is the toolbar's Changes menu now.
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
    <div className="totals" role="group" aria-label="Resources by kind of change">
      {/* The headline counts stacks; these count resources. Said, so the two aren't read as one. */}
      <span className="totals__label">Resources</span>
      {rungs.map((severity) => {
        const count = props.counts[severity];
        const potential = props.potentialCounts?.[severity] ?? 0;
        return (
          <span key={severity} className="total" data-rung={severity}>
            <b
              className="total__count"
              data-tone={SEVERITY_RANK[severity] >= SEVERITY_RANK.create ? SEVERITY_TONE[severity] : undefined}
            >
              {count}
            </b>{' '}
            {SEVERITY_LABEL[severity]}
            {potential > 0 && <span className="total__sub">, {potential} potential</span>}
          </span>
        );
      })}
    </div>
  );
}
