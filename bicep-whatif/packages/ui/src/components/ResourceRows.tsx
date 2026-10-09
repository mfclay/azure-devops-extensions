import { SEVERITY_TONE } from '@bicep-whatif/core';
import type { GridRow, StackView } from '../model/estate.js';
import { Glyph } from './Glyph.js';
import { RowDetail } from './RowDetail.js';

/**
 * Show the reason only when the rung is not what the change type alone predicts.
 *
 * A `modify` that ranked `modify` explains itself; printing "Properties change on
 * an existing resource" on two hundred rows would train people to stop reading
 * the line, and then the one row that says "the stack stops governing this
 * resource" gets skipped along with the rest. So the line appears exactly when it
 * is load-bearing — which is also exactly when the ranking looks surprising.
 */
export function surprisingReason(row: GridRow): string | undefined {
  // A potential change always says so: it is the one thing that row's rank
  // cannot tell you.
  if (row.certaintyNote !== undefined) return row.certaintyNote;
  const top = row.reasons[0];
  if (!top) return undefined;
  if (row.isStagePlaceholder) return top.detail;
  const routine = top.code === 'resourceModified' || top.code === 'resourceCreated' || top.code === 'noChange';
  if (routine && row.reasons.length <= 1) return undefined;
  return top.detail;
}

export interface ResourceRowsProps {
  rows: readonly GridRow[];
  open: ReadonlySet<string>;
  stacks: ReadonlyMap<string, StackView>;
  hideNoise: boolean;
  /** The flat list names each row's stack; a stack's own rows do not need to. */
  withStack: boolean;
  onToggle: (key: string) => void;
}

/**
 * Resource rows, each opening in place beneath itself.
 *
 * Not virtualized. Rows that open in place have no fixed height, and the
 * estates this reads are hundreds of rows, not tens of thousands; the stack
 * layout renders only the stacks someone opened. Sorting and filtering stay
 * pure functions in `model/view.ts`.
 */
export function ResourceRows(props: ResourceRowsProps): React.ReactElement {
  return (
    <div className="rows" data-with-stack={props.withStack}>
      {props.rows.map((row) => {
        const open = props.open.has(row.key);
        const why = surprisingReason(row);
        return (
          <div className="rowwrap" key={row.key} data-row-key={row.key}>
            <div
              className="row"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              data-open={open}
              onClick={() => {
                props.onToggle(row.key);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onToggle(row.key);
                }
              }}
            >
              {/*
                The severity rail. Opacity tracks rank, so same-rung rows form
                one band and the left edge reads as a histogram of the run.
              */}
              <span
                className="rail"
                data-tone={SEVERITY_TONE[row.severity]}
                data-rank={row.severityRank}
                data-potential={row.potential && row.severity !== 'unevaluated'}
                aria-hidden="true"
              />
              <Glyph severity={row.severity} label={row.isStagePlaceholder ? 'not evaluated' : undefined} />
              <span className="cell cell--name">
                <span className="cell__name">
                  <span className="chev" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  {row.name}
                  {row.potential && <span className="pill">potential</span>}
                </span>
                {why !== undefined && <span className="cell__why">{why}</span>}
              </span>
              {props.withStack && <span className="cell cell--mono">{row.stackLabel}</span>}
              <span className="cell cell--mono cell--type" title={row.resourceType}>
                {row.resourceType.split('/').pop() ?? row.resourceType}
              </span>
              <span className="cell cell--change" data-known={row.changeTypeKnown}>
                {row.changeType}
              </span>
            </div>
            {open && (
              <RowDetail
                row={row}
                stack={props.stacks.get(row.stackKey)}
                hideNoise={props.hideNoise}
                withStack={props.withStack}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
