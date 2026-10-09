import { needsAttention } from '@bicep-whatif/core';
import type { StackView } from '../model/estate.js';

/**
 * Azure's own warnings about a what-if, said out loud.
 *
 * A module or resource whose id cannot be worked out before the deploy is
 * short-circuited: left out of the result and named only in the payload's
 * `diagnostics`. That is the correctness rule again — a stack whose what-if
 * Azure calls incomplete must not read as complete. Info-level messages stay in
 * the detail panel. Like the not-evaluated banner, this does not dismiss.
 */
export function DiagnosticsBanner({ stacks }: { stacks: readonly StackView[] }): React.ReactElement | null {
  const flagged = stacks
    .map((s) => ({ stack: s, diagnostics: (s.stack?.diagnostics ?? []).filter(needsAttention) }))
    .filter((f) => f.diagnostics.length > 0);
  if (flagged.length === 0) return null;

  const count = flagged.reduce((n, f) => n + f.diagnostics.length, 0);
  return (
    <div className="banner" role="status" aria-label="Azure diagnostics">
      <span className="banner__glyph" aria-hidden="true">
        !
      </span>
      <div>
        <p className="banner__text">
          <strong>
            Azure reported {count} {count === 1 ? 'warning' : 'warnings'} on {flagged.length}{' '}
            {flagged.length === 1 ? 'stack' : 'stacks'}.
          </strong>{' '}
          Resources can be missing from a what-if result, or predicted without certainty. Read{' '}
          {count === 1 ? 'it' : 'them'} before trusting what is shown.
        </p>
        <ul className="banner__notes">
          {flagged.flatMap((f) =>
            f.diagnostics.map((d, i) => (
              <li key={`${f.stack.key}:${String(i)}`}>
                <span className="banner__stacks">{f.stack.label}</span> · {d.code ?? d.level}: {d.message}
              </li>
            )),
          )}
        </ul>
      </div>
    </div>
  );
}
