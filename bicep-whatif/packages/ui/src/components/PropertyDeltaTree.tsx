import type { PropertyChange } from '@bicep-whatif/core';

/**
 * The property delta tree.
 *
 * Two things here are easy to get wrong, and both were found by `core`'s tests:
 *
 *  - The property-level `changeType` is a **different enum** from the
 *    resource-level one. It adds `array` and `noEffect` — both present in the
 *    real build-7700017 captures — and drops `detach` and `noChange`. Rendering
 *    these with the resource severity glyphs would render wrong, so they get
 *    their own short word marks and no `SEVERITY_GLYPH` appears anywhere below.
 *  - `children` nests, three levels deep in the real captures, so this recurses.
 */

/** Marks for the property enum. Deliberately words, not the resource glyph set. */
const MARK: Readonly<Record<string, string>> = Object.freeze({
  create: 'add',
  delete: 'del',
  modify: 'mod',
  array: 'arr',
  noEffect: 'noop',
});

function renderValue(value: unknown): React.ReactElement {
  if (value === undefined) return <span className="val val--empty">absent</span>;
  if (value === null) return <span className="val val--empty">null</span>;
  if (typeof value === 'string') return <>{value.length === 0 ? <span className="val--empty">empty</span> : value}</>;
  if (typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>;
  // Objects and arrays appear at leaves the provider reports wholesale. Compact
  // JSON keeps the row scannable; the full bodies are one section further down.
  const json = JSON.stringify(value);
  return <>{json.length > 160 ? `${json.slice(0, 157)}…` : json}</>;
}

/**
 * Whether there is a before/after pair worth drawing.
 *
 * Container nodes — an `array` node, or an index node holding children — carry
 * `null` on both sides, and rendering `null → null` under every one of them is
 * pure noise. Suppressed only when the two sides are identical, so a real
 * difference is never the thing that goes missing.
 */
function hasValues(change: PropertyChange): boolean {
  if (change.before === change.after) return false;
  return change.before !== undefined || change.after !== undefined;
}

/**
 * `hideNoise` is decision C4's thin client-side toggle. It hides nodes that carry
 * no before/after difference and no changed children — never a node that
 * actually changed. Hiding a real change is the one failure that destroys trust,
 * so this filter can only ever remove nodes that say nothing.
 */
function isSilent(change: PropertyChange): boolean {
  if (change.changeType === 'noEffect') return true;
  if (hasValues(change)) return false;
  return change.children.every(isSilent);
}

export function PropertyDeltaTree({
  changes,
  hideNoise,
  nested = false,
}: {
  changes: readonly PropertyChange[];
  hideNoise: boolean;
  nested?: boolean;
}): React.ReactElement | null {
  const shown = hideNoise ? changes.filter((c) => !isSilent(c)) : changes;
  if (shown.length === 0) return null;

  return (
    <ul className={nested ? 'delta delta--nested' : 'delta'}>
      {shown.map((change, i) => (
        <li className="delta__node" key={`${change.path}:${String(i)}`}>
          <div className="delta__head">
            <span
              className="delta__mark"
              data-ct={change.changeType}
              data-known={change.changeTypeKnown}
              title={String(change.changeType)}
            >
              {MARK[String(change.changeType)] ?? String(change.changeType)}
            </span>
            <span className="delta__path">{change.path}</span>
          </div>

          {hasValues(change) && (
            <div className="delta__values">
              <span className="val val--before">{renderValue(change.before)}</span>
              <span className="delta__arrow" aria-hidden="true">
                →
              </span>
              <span className="val val--after">{renderValue(change.after)}</span>
            </div>
          )}

          {change.changeType === 'noEffect' && (
            <div className="delta__values">
              <span className="delta__note">The provider will ignore this property.</span>
            </div>
          )}

          <PropertyDeltaTree changes={change.children} hideNoise={hideNoise} nested />
        </li>
      ))}
    </ul>
  );
}
