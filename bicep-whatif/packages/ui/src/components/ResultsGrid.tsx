import { SEVERITY_TONE } from '@bicep-whatif/core';
import { createColumnHelper, createCoreRowModel, flexRender, useTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Fragment, useMemo, useRef } from 'react';
import type { GridRow } from '../model/estate.js';
import { Glyph } from './Glyph.js';

const ROW_HEIGHT = 34;

/**
 * No optional table features: sorting and filtering are pure functions in
 * `model/view.ts`, where they can be tested without a component. The table earns
 * its place as the column model and the cell renderer, and nothing more.
 */
const FEATURES = {};
type GridFeatures = typeof FEATURES;

const helper = createColumnHelper<GridFeatures, GridRow>();

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

/** Each cell renders the grid item itself — no wrapper, or the columns collapse. */
const columns = [
  helper.display({
    id: 'severity',
    cell: ({ row }) => <Glyph severity={row.original.severity} title={row.original.severity} />,
  }),
  helper.display({
    id: 'name',
    cell: ({ row }) => {
      const why = surprisingReason(row.original);
      return (
        <span className="cell cell--name">
          <span className="cell__name">
            {row.original.name}
            {row.original.potential && <span className="pill">potential</span>}
          </span>
          {why !== undefined && <span className="cell__why">{why}</span>}
        </span>
      );
    },
  }),
  helper.display({
    id: 'stackLabel',
    cell: ({ row }) => <span className="cell cell--mono">{row.original.stackLabel}</span>,
  }),
  helper.display({
    id: 'resourceType',
    cell: ({ row }) => (
      <span className="cell cell--mono cell--type" title={row.original.resourceType}>
        {row.original.resourceType.split('/').pop() ?? row.original.resourceType}
      </span>
    ),
  }),
  helper.display({
    id: 'changeType',
    cell: ({ row }) => (
      <span className="cell cell--change" data-known={row.original.changeTypeKnown}>
        {row.original.changeType}
      </span>
    ),
  }),
];

export interface ResultsGridProps {
  rows: readonly GridRow[];
  selected: string | null;
  onSelect: (key: string) => void;
  onReset: () => void;
}

export function ResultsGrid(props: ResultsGridProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const data = useMemo(() => [...props.rows], [props.rows]);

  const table = useTable<GridFeatures, GridRow>({
    features: { coreRowModel: createCoreRowModel<GridFeatures, GridRow>() },
    data,
    columns,
    getRowId: (row) => row.key,
  });

  const rowModel = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="grid">
      <div className="grid__head">
        <span />
        <span />
        <span>Resource</span>
        <span>Stack</span>
        <span className="cell--type">Type</span>
        <span>Change</span>
      </div>

      <div className="grid__scroll" ref={scrollRef}>
        {rowModel.rows.length === 0 ? (
          <div className="grid__empty">
            <p>Nothing matches these filters.</p>
            <button type="button" className="btn" onClick={props.onReset}>
              Show everything
            </button>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rowModel.rows[item.index];
              if (!row) return null;
              const original = row.original;
              const selected = props.selected === original.key;
              return (
                <div
                  key={row.id}
                  className="grid__row"
                  role="button"
                  tabIndex={0}
                  data-selected={selected}
                  aria-pressed={selected}
                  style={{ transform: `translateY(${String(item.start)}px)` }}
                  onClick={() => {
                    props.onSelect(original.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      props.onSelect(original.key);
                    }
                  }}
                >
                  {/*
                    The severity rail. Opacity tracks rank, so same-rung rows form
                    one band and the left edge reads as a histogram of the run.
                  */}
                  <span
                    className="rail"
                    data-tone={SEVERITY_TONE[original.severity]}
                    data-rank={original.severityRank}
                    data-potential={original.potential && original.severity !== 'unevaluated'}
                    aria-hidden="true"
                  />
                  {row.getAllCells().map((cell) => (
                    <Fragment key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Fragment>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
