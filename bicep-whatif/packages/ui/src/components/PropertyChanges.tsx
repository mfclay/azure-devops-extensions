import type { PropertyChange } from '@bicep-whatif/core';
import { hasValues, propertyLines } from '../model/propertyLines.js';

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
 *    flattens it to one path per line (`properties.subnets[0].name`), so a nested
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

export function PropertyChanges({
  changes,
  hideNoise,
}: {
  changes: readonly PropertyChange[];
  hideNoise: boolean;
}): React.ReactElement | null {
  const lines = propertyLines(changes, hideNoise);
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
