import type { PropertyChange } from '@bicep-whatif/core';
import { Fragment, useEffect, useState } from 'react';
import {
  groupMatches,
  hasValues,
  isAbsent,
  linesOfItem,
  propertyItems,
  propertyTally,
  type PropertyItem,
  type PropertyLine,
} from '../model/propertyLines.js';
import { Chevron } from './Glyph.js';

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
 *
 * Where every leaf under one element says the same thing (seven `del` lines
 * under `virtualNetworkPeerings[1]`), they sit under one group row that says it
 * once. Groups start open and fold on request, and a search that matches a line
 * inside one opens it again: decision C4 says no control hides a line that
 * changed, and a default that hid the before values would.
 */

/** Marks for the property enum. Deliberately words, not the resource glyph set. */
const MARK: Readonly<Record<string, string>> = Object.freeze({
  create: 'add',
  delete: 'del',
  modify: 'mod',
  array: 'arr',
  noEffect: 'noop',
});

/** `absent` only where the model says the value means "not there"; elsewhere `null` is a real value. */
function renderValue(change: PropertyChange, side: 'before' | 'after'): React.ReactElement {
  const value = side === 'before' ? change.before : change.after;
  if (isAbsent(change, side)) return <span className="val--empty">absent</span>;
  if (value === null || value === undefined) return <span className="val--empty">null</span>;
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

function markOf(change: PropertyChange): string {
  return MARK[String(change.changeType)] ?? String(change.changeType);
}

function Line({ line, shownPath }: { line: PropertyLine; shownPath: string }): React.ReactElement {
  const { change } = line;
  return (
    <tr>
      <td
        className="delta__mark"
        data-ct={change.changeType}
        data-known={change.changeTypeKnown}
        title={String(change.changeType)}
      >
        {markOf(change)}
      </td>
      <td className="delta__path" title={shownPath === line.path ? undefined : line.path}>
        {breakable(shownPath)}
      </td>
      {change.changeType === 'noEffect' ? (
        <td className="delta__note" colSpan={2}>
          The provider will ignore this property.
        </td>
      ) : hasValues(change) ? (
        <>
          <td>
            <span className="val val--before">{renderValue(change, 'before')}</span>
          </td>
          <td>
            <span className="val val--after">{renderValue(change, 'after')}</span>
          </td>
        </>
      ) : (
        <td colSpan={2} />
      )}
    </tr>
  );
}

export function PropertyChanges({
  changes,
  hideNoise,
  query = '',
}: {
  changes: readonly PropertyChange[];
  hideNoise: boolean;
  /** The tab's search. A group with a matching line opens. */
  query?: string;
}): React.ReactElement | null {
  const items = propertyItems(changes, hideNoise);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  // A search that finds a line inside a folded group opens it. It can be folded again after.
  useEffect(() => {
    const opened = items.filter((it) => it.kind === 'group' && closed.has(it.path) && groupMatches(it, query));
    if (opened.length === 0) return;
    setClosed((c) => {
      const next = new Set(c);
      for (const it of opened) if (it.kind === 'group') next.delete(it.path);
      return next;
    });
    // Only a change of search re-opens; folding a group by hand afterwards sticks.
  }, [query]);

  if (items.length === 0) return null;
  const tally = propertyTally(items.flatMap(linesOfItem));

  const toggle = (path: string): void => {
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderItem = (item: PropertyItem, i: number): React.ReactElement => {
    if (item.kind === 'line') return <Line key={`${item.line.path}:${String(i)}`} line={item.line} shownPath={item.line.path} />;
    if (item.kind === 'ignored') {
      return (
        <tr key={`ignored:${String(i)}`} className="delta__ignored">
          <td className="delta__mark" data-ct="noEffect">
            noop ×{item.lines.length}
          </td>
          <td className="delta__note" colSpan={3}>
            {item.lines.map((l, j) => (
              <Fragment key={l.path}>
                {j > 0 && ', '}
                <span className="delta__path">{l.path}</span>
              </Fragment>
            ))}{' '}
            — the provider will ignore these.
          </td>
        </tr>
      );
    }
    const open = !closed.has(item.path);
    const mark = markOf(item.lines[0]!.change);
    return (
      <Fragment key={item.path}>
        <tr className="delta__grouprow">
          <td colSpan={4}>
            <button
              type="button"
              className="delta__group"
              aria-expanded={open}
              onClick={() => {
                toggle(item.path);
              }}
            >
              <span className="delta__mark" data-ct={item.changeType}>
                {mark} ×{item.lines.length}
              </span>
              <span className="delta__grouphead">
                <Chevron open={open} />
                <span className="delta__grouppath">{item.path}</span>
                <span className="delta__groupsummary">{item.summary}</span>
                {!open && <span className="delta__show">Show {item.lines.length}</span>}
              </span>
            </button>
          </td>
        </tr>
        {open && item.lines.map((line) => <Line key={line.path} line={line} shownPath={`…${line.relPath}`} />)}
      </Fragment>
    );
  };

  return (
    <div className="delta">
      <p className="delta__tally">{tally}</p>
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
        <tbody>{items.map(renderItem)}</tbody>
      </table>
    </div>
  );
}
