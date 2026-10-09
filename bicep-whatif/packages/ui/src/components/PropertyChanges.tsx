import type { PropertyChange } from '@bicep-whatif/core';

/**
 * A resource's property changes, as one table: property, before, after.
 *
 * Two things here are easy to get wrong, and both were found by `core`'s tests:
 *
 *  - The property-level `changeType` is a **different enum** from the
 *    resource-level one. It adds `array` and `noEffect` — both present in the
 *    real build-7700017 captures — and drops `detach` and `noChange`. Rendering
 *    these with the resource severity glyphs would render wrong, so they get
 *    their own short word marks and no `SEVERITY_GLYPH` appears anywhere below.
 *  - `children` nests, three levels deep in the real captures. The table
 *    flattens it to dotted paths (`properties.subnets.0.name`), so a nested
 *    change reads the same as a top-level one and the columns stay aligned.
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
  if (value === undefined) return <span className="val--empty">absent</span>;
  if (value === null) return <span className="val--empty">null</span>;
  if (typeof value === 'string') return <>{value.length === 0 ? <span className="val--empty">empty</span> : value}</>;
  if (typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>;
  // Objects and arrays appear at leaves the provider reports wholesale. Compact
  // JSON keeps the row scannable.
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
 * `hideNoise` is decision C4's thin client-side toggle. It hides lines that
 * carry no before/after difference — never a line that actually changed.
 * Hiding a real change is the one failure that destroys trust, so this filter
 * can only ever remove lines that say nothing.
 */
function isSilent(change: PropertyChange): boolean {
  if (change.changeType === 'noEffect') return true;
  return !hasValues(change);
}

/** A dotted path that wraps after a dot rather than mid-name. */
function breakable(path: string): React.ReactNode {
  const parts = path.split('.');
  return parts.map((part, i) => (
    <span key={String(i)}>
      {part}
      {i < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </span>
  ));
}

interface Line {
  path: string;
  change: PropertyChange;
}

/**
 * One line per node that says something on its own: a node with values, a
 * leaf, or a node whose type the reader should see (`noEffect`, or a type this
 * build does not know). A container that only holds children is named by its
 * children's paths instead.
 */
function linesOf(changes: readonly PropertyChange[], prefix: string, hideNoise: boolean): Line[] {
  const out: Line[] = [];
  for (const change of changes) {
    const path = prefix && change.path ? `${prefix}.${change.path}` : prefix || change.path;
    const speaks =
      hasValues(change) ||
      change.children.length === 0 ||
      change.changeType === 'noEffect' ||
      !change.changeTypeKnown;
    if (speaks && !(hideNoise && isSilent(change))) out.push({ path, change });
    out.push(...linesOf(change.children, path, hideNoise));
  }
  return out;
}

/** Whether the table would draw anything at all with this noise setting. */
export function hasPropertyLines(changes: readonly PropertyChange[], hideNoise: boolean): boolean {
  return linesOf(changes, '', hideNoise).length > 0;
}

export function PropertyChanges({
  changes,
  hideNoise,
}: {
  changes: readonly PropertyChange[];
  hideNoise: boolean;
}): React.ReactElement | null {
  const lines = linesOf(changes, '', hideNoise);
  if (lines.length === 0) return null;

  return (
    <div className="delta">
      <table className="delta__table">
        <colgroup>
          <col className="delta__col-mark" />
          <col className="delta__col-path" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Change</span>
            </th>
            <th scope="col">Property</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ path, change }, i) => (
            <tr key={`${path}:${String(i)}`}>
              <td
                className="delta__mark"
                data-ct={change.changeType}
                data-known={change.changeTypeKnown}
                title={String(change.changeType)}
              >
                {MARK[String(change.changeType)] ?? String(change.changeType)}
              </td>
              <td className="delta__path">{breakable(path)}</td>
              {change.changeType === 'noEffect' ? (
                <td className="delta__note" colSpan={2}>
                  The provider will ignore this property.
                </td>
              ) : hasValues(change) ? (
                <>
                  <td>
                    <span className="val val--before">{renderValue(change.before)}</span>
                  </td>
                  <td>
                    <span className="val val--after">{renderValue(change.after)}</span>
                  </td>
                </>
              ) : (
                <td colSpan={2} />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
