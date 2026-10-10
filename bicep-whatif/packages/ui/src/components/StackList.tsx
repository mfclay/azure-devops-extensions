import { SEVERITIES, SEVERITY_RANK, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';
import { useMemo } from 'react';
import { warningLines } from '../model/diagnostics.js';
import type { GridRow, StackView } from '../model/estate.js';
import { stackTwins, type StackGroup } from '../model/summary.js';
import { Chevron, Glyph, SEVERITY_LABEL, WarningIcon } from './Glyph.js';
import { ResourceRows } from './ResourceRows.js';
import { StackDetail } from './StackDetail.js';

/** Column order: the rungs, most severe first. */
const COLUMNS: readonly Severity[] = [...SEVERITIES].reverse();

export interface StackListProps {
  groups: readonly StackGroup[];
  /** Each stack's resource rows that pass the filters, sorted. No stage placeholders. */
  rowsByStack: ReadonlyMap<string, readonly GridRow[]>;
  /** Each stack's resource rows, unfiltered. */
  allRowsByStack: ReadonlyMap<string, readonly GridRow[]>;
  stacks: ReadonlyMap<string, StackView>;
  openStacks: ReadonlySet<string>;
  openRows: ReadonlySet<string>;
  hideNoise: boolean;
  /** The tab's search, passed down to the property table. */
  query?: string | undefined;
  /** Whether unchanged rows are filtered out, so a stack can offer to show them. */
  unchangedHidden: boolean;
  onToggleStack: (key: string) => void;
  onToggleRow: (key: string) => void;
  onShowUnchanged: () => void;
}

/**
 * One line under the stack's name for each thing worth knowing before opening
 * it. Azure's warnings are said in a plain sentence each; its own text, which
 * shouts, is one click away in the opened stack, and a closed line says so.
 */
function notesFor(stack: StackView, open: boolean): { text: string; tone: 'warning' | 'muted' }[] {
  const out: { text: string; tone: 'warning' | 'muted' }[] = [];
  if (stack.notEvaluatedDetail !== undefined) out.push({ text: stack.notEvaluatedDetail, tone: 'muted' });
  for (const line of warningLines(stack)) {
    out.push({ text: open ? line : `${line} Open for Azure's message.`, tone: 'warning' });
  }
  if (stack.stack?.denySettingsWeakened === true) {
    out.push({ text: 'Deny settings weaken in this run.', tone: 'warning' });
  }
  return out;
}

function Counts({ stack, rows }: { stack: StackView; rows: readonly GridRow[] }): React.ReactElement {
  if (!stack.evaluated) {
    return (
      <span className="stack__noresult" style={{ gridColumn: `span ${String(COLUMNS.length)}` }}>
        no result
      </span>
    );
  }
  return (
    <>
      {COLUMNS.map((rung) => {
        const n = stack.counts[rung];
        const potential = rows.filter((r) => r.severity === rung && r.potential).length;
        const label = `${String(n)} ${SEVERITY_LABEL[rung]}${potential > 0 ? `, ${String(potential)} potential` : ''}`;
        return (
          <span
            key={rung}
            className="stack__count"
            data-rung={rung}
            data-tone={n > 0 && SEVERITY_RANK[rung] >= SEVERITY_RANK.create ? SEVERITY_TONE[rung] : undefined}
            data-zero={n === 0}
            data-potential={potential > 0}
            title={n > 0 ? label : undefined}
            aria-label={label}
          >
            {n > 0 ? n : '·'}
          </span>
        );
      })}
    </>
  );
}

function StackLine(props: StackListProps & { stack: StackView; twin: string | undefined }): React.ReactElement {
  const { stack, twin } = props;
  const open = props.openStacks.has(stack.key);
  const rows = props.rowsByStack.get(stack.key) ?? [];
  const all = props.allRowsByStack.get(stack.key) ?? [];
  const shown = new Set(rows.map((r) => r.key));
  const hidden = all.filter((r) => !shown.has(r.key));
  const hiddenUnchanged = props.unchangedHidden ? hidden.filter((r) => r.severity === 'noChange').length : 0;
  const hiddenOther = hidden.length - hiddenUnchanged;
  const notes = notesFor(stack, open);
  const potential = all.some((r) => r.potential && r.severity === stack.highestSeverity);
  const toggle = (): void => {
    props.onToggleStack(stack.key);
  };

  return (
    <div className="stackwrap" data-stack-key={stack.key}>
      <div
        className="stack"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-open={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span
          className="rail"
          data-tone={stack.highestSeverity ? SEVERITY_TONE[stack.highestSeverity] : 'neutral'}
          data-rank={stack.highestSeverity ? SEVERITY_RANK[stack.highestSeverity] : 0}
          data-potential={potential && stack.highestSeverity !== 'unevaluated'}
          aria-hidden="true"
        />
        {stack.highestSeverity ? (
          <Glyph severity={stack.highestSeverity} label={stack.evaluated ? undefined : 'not evaluated'} />
        ) : (
          <span />
        )}
        <span className="stack__who">
          <span className="stack__title">
            <Chevron open={open} />
            <span className="stack__name">{stack.label}</span>
            {/* Another line carries this name: the stage is what tells them apart, so it is said louder. */}
            {twin !== undefined ? (
              <span className="stack__stagechip">{stack.stageDisplayName}</span>
            ) : (
              stack.stageDisplayName !== stack.label && <span className="stack__stage">{stack.stageDisplayName}</span>
            )}
          </span>
          {twin !== undefined && <span className="stack__twin">· {twin}</span>}
          {notes.map((n, i) => (
            <span key={String(i)} className="stack__note" data-tone={n.tone}>
              {n.tone === 'warning' && <WarningIcon />}
              <span>{n.text}</span>
            </span>
          ))}
        </span>
        <Counts stack={stack} rows={all} />
      </div>

      {open && (
        <div className="stack__body">
          <StackDetail stack={stack} />
          {rows.length > 0 && (
            <ResourceRows
              rows={rows}
              open={props.openRows}
              stacks={props.stacks}
              hideNoise={props.hideNoise}
              query={props.query}
              withStack={false}
              onToggle={props.onToggleRow}
            />
          )}
          {(hiddenUnchanged > 0 || hiddenOther > 0) && (
            <p className="stack__hidden">
              {hiddenUnchanged > 0 && (
                <>
                  {hiddenUnchanged} unchanged {hiddenUnchanged === 1 ? 'resource' : 'resources'} not shown.{' '}
                  <button type="button" className="linkbtn" onClick={props.onShowUnchanged}>
                    Show unchanged
                  </button>
                </>
              )}
              {hiddenOther > 0 && (
                <span className="muted">
                  {' '}
                  {hiddenOther} more hidden by the filters.
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The stack layout: one line per stack, grouped and worst first, each line
 * carrying its own counts in one column per rung. A stack opens to what is
 * true of it as a whole, then its rows, each of which opens in place.
 */
export function StackList(props: StackListProps): React.ReactElement {
  const titled = props.groups.length > 1;
  const twins = useMemo(() => stackTwins([...props.stacks.values()]), [props.stacks]);
  return (
    <div className="stacks">
      <div className="stacks__head" aria-hidden="true">
        <span />
        <span />
        <span>Stack · resources per stack →</span>
        {COLUMNS.map((rung) => (
          <span key={rung} className="stack__colhead" data-rung={rung}>
            {SEVERITY_LABEL[rung]}
          </span>
        ))}
      </div>
      {props.groups.map((group) => (
        <section key={group.kind} className="stacks__group" aria-label={group.title} data-kind={group.kind}>
          {titled && <h2 className="stacks__title">{group.title}</h2>}
          {group.stacks.map((stack) => (
            <StackLine key={stack.key} {...props} stack={stack} twin={twins.get(stack.key)} />
          ))}
        </section>
      ))}
      <Legend />
    </div>
  );
}

/** What the rail's patterns and the icons mean, once, under the list. */
function Legend(): React.ReactElement {
  return (
    <div className="legend">
      <span className="legend__item">
        <span className="legend__swatch" data-kind="potential" aria-hidden="true" />
        dashed = potential: Azure couldn’t tell whether it happens
      </span>
      <span className="legend__item">
        <span className="legend__swatch" data-kind="noresult" aria-hidden="true" />
        hatched = no result for this stack
      </span>
      {COLUMNS.map((rung) => (
        <span key={rung} className="legend__item">
          <Glyph severity={rung} size={18} decorative />
          {rung === 'unevaluated' ? 'not evaluated / not predicted' : SEVERITY_LABEL[rung]}
        </span>
      ))}
    </div>
  );
}
