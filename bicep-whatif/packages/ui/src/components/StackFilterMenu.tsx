import type { Severity } from '@bicep-whatif/core';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { StackView } from '../model/estate.js';
import { groupStacks, prefixGroupingHelps } from '../model/layers.js';
import { needsALook, stackMatches, stackTwins, summaryGroups, type StackGroupKind } from '../model/summary.js';
import { Glyph } from './Glyph.js';
import { useDismiss } from './useDismiss.js';

export interface StackFilterMenuProps {
  stacks: readonly StackView[];
  /** `null` means every stack, including ones a later build might add. */
  selected: ReadonlySet<string> | null;
  onChange: (keys: string[]) => void;
}

type GroupBy = 'outcome' | 'prefix';

interface MenuGroup {
  key: string;
  label: string;
  /** Set when grouped by outcome, so the heading takes the group's tone. */
  kind?: StackGroupKind;
  stackIds: readonly string[];
}

/**
 * The stack filter, built for thirty rather than for nine.
 *
 * Grouped by outcome, in the order the first screen uses, so "every stack that
 * might delete something" is one click, and so is "needs a look": the stacks
 * that will or might, and the ones nobody evaluated. Grouping by name prefix
 * (`workload-alpha-…`) is offered only when the estate is named that way;
 * otherwise it yields one lone "Other" heading, which says nothing. Search
 * finds a stack by its name or its stage's.
 */
export function StackFilterMenu(props: StackFilterMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('outcome');
  const root = useRef<HTMLDivElement>(null);

  const allKeys = useMemo(() => props.stacks.map((s) => s.key), [props.stacks]);
  const selectedCount = props.selected === null ? allKeys.length : props.selected.size;
  const prefixHelps = useMemo(() => prefixGroupingHelps(allKeys), [allKeys]);
  const by: GroupBy = prefixHelps ? groupBy : 'outcome';
  const lookKeys = useMemo(() => needsALook(props.stacks), [props.stacks]);
  const twins = useMemo(() => stackTwins(props.stacks), [props.stacks]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, close, root);

  const byKey = useMemo(() => new Map(props.stacks.map((s) => [s.key, s])), [props.stacks]);
  const visible = useMemo(() => props.stacks.filter((s) => stackMatches(s, query)).map((s) => s.key), [props.stacks, query]);
  const groups = useMemo((): MenuGroup[] => {
    if (by === 'prefix') {
      return groupStacks(visible).map((g) => ({ key: g.key || 'other', label: g.label, stackIds: g.stackIds }));
    }
    const shown = new Set(visible);
    return summaryGroups(props.stacks)
      .map((g) => ({
        key: g.kind,
        label: g.menuTitle,
        kind: g.kind,
        stackIds: g.stacks.map((s) => s.key).filter((k) => shown.has(k)),
      }))
      .filter((g) => g.stackIds.length > 0);
  }, [by, visible, props.stacks]);

  const isOn = (key: string): boolean => props.selected === null || props.selected.has(key);

  const setKeys = (keys: Iterable<string>): void => {
    props.onChange([...new Set(keys)]);
  };

  const toggle = (key: string): void => {
    const current = new Set(props.selected === null ? allKeys : props.selected);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    setKeys(current);
  };

  const setGroup = (keys: readonly string[], on: boolean): void => {
    const current = new Set(props.selected === null ? allKeys : props.selected);
    for (const k of keys) {
      if (on) current.add(k);
      else current.delete(k);
    }
    setKeys(current);
  };

  /** The stage under the name: when another stack shares the name, or when only the stage matched the search. */
  const stageLine = (stack: StackView): string | undefined => {
    if (stack.stageDisplayName === stack.label) return undefined;
    if (twins.has(stack.key)) return `stage ${stack.stageDisplayName}`;
    const q = query.trim().toLowerCase();
    if (q.length > 0 && !stack.label.toLowerCase().includes(q)) return `stage ${stack.stageDisplayName}`;
    return undefined;
  };

  return (
    <div className="stackmenu" ref={root}>
      <button
        type="button"
        className="btn"
        data-active={props.selected !== null}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Stacks ({selectedCount} of {allKeys.length}) ▾
      </button>

      {open && (
        <div className="stackmenu__panel">
          <div className="stackmenu__top">
            <input
              className="stackmenu__search"
              type="search"
              placeholder="Find a stack or stage"
              aria-label="Find a stack or stage"
              value={query}
              autoFocus
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
            <div className="stackmenu__quick" role="group" aria-label="Quick picks">
              <span className="muted">Quick:</span>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setKeys(allKeys);
                }}
              >
                All
              </button>
              <button
                type="button"
                className="chip"
                disabled={lookKeys.length === 0}
                onClick={() => {
                  setKeys(lookKeys);
                }}
              >
                Needs a look ({lookKeys.length})
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setKeys([]);
                }}
              >
                None
              </button>
            </div>
          </div>
          <div className="stackmenu__list">
            {visible.length === 0 && <p className="stackmenu__empty">No stack matches “{query}”.</p>}
            {groups.map((group) => (
              <div key={group.key}>
                <div className="stackmenu__group" data-by={by} data-kind={group.kind}>
                  <span className="stackmenu__grouplabel">{group.label}</span>
                  <span className="stackmenu__grouplinks">
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() => {
                        setGroup(group.stackIds, true);
                      }}
                    >
                      all
                    </button>
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() => {
                        setGroup(group.stackIds, false);
                      }}
                    >
                      none
                    </button>
                  </span>
                </div>
                {group.stackIds.map((key) => {
                  const stack = byKey.get(key);
                  const worst: Severity = stack?.highestSeverity ?? 'noChange';
                  const total = stack?.evaluated === false ? 1 : (stack?.stack?.total ?? 0);
                  const stage = stack === undefined ? undefined : stageLine(stack);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="stackmenu__item"
                      role="menuitemcheckbox"
                      aria-checked={isOn(key)}
                      onClick={() => {
                        toggle(key);
                      }}
                    >
                      <input type="checkbox" checked={isOn(key)} readOnly tabIndex={-1} />
                      <Glyph
                        severity={worst}
                        size={18}
                        className="stackmenu__worst"
                        label={stack?.evaluated === false ? 'not evaluated' : undefined}
                      />
                      <span className="stackmenu__who">
                        <span className="stackmenu__name">{stack?.label ?? key}</span>
                        {stage !== undefined && <span className="stackmenu__stage">{stage}</span>}
                      </span>
                      <span className="stackmenu__count">{total}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="stackmenu__foot">
            {prefixHelps && (
              <div className="stackmenu__groupby" role="group" aria-label="Group by">
                <span className="muted">Group by</span>
                <span className="seg">
                  <button
                    type="button"
                    className="seg__btn"
                    aria-pressed={by === 'outcome'}
                    onClick={() => {
                      setGroupBy('outcome');
                    }}
                  >
                    Outcome
                  </button>
                  <button
                    type="button"
                    className="seg__btn"
                    aria-pressed={by === 'prefix'}
                    onClick={() => {
                      setGroupBy('prefix');
                    }}
                  >
                    Name prefix
                  </button>
                </span>
              </div>
            )}
            <span className="stackmenu__selected">
              {selectedCount} of {allKeys.length} selected
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
