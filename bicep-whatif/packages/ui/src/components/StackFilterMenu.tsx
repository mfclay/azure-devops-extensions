import type { Severity } from '@bicep-whatif/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StackView } from '../model/estate.js';
import { groupStacks } from '../model/layers.js';
import { Glyph } from './Glyph.js';

export interface StackFilterMenuProps {
  stacks: readonly StackView[];
  /** `null` means every stack, including ones a later build might add. */
  selected: ReadonlySet<string> | null;
  onChange: (keys: string[]) => void;
}

/**
 * The stack filter, built for thirty rather than for nine.
 *
 * The estate is heading for `5 + 4N`, so this is a searchable multi-select
 * grouped by layer rather than a flat list — grouping falls straight out of the
 * stack-id shape and gives "everything for this client" in one click. Each row
 * shows the worst rung in that stack, so the menu answers "which stack is on
 * fire" without closing it.
 */
export function StackFilterMenu(props: StackFilterMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);

  const allKeys = useMemo(() => props.stacks.map((s) => s.key), [props.stacks]);
  const selectedCount = props.selected === null ? allKeys.length : props.selected.size;

  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const byKey = useMemo(() => new Map(props.stacks.map((s) => [s.key, s])), [props.stacks]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q.length === 0 ? allKeys : allKeys.filter((k) => (byKey.get(k)?.label ?? k).toLowerCase().includes(q))),
    [allKeys, byKey, q],
  );
  const groups = useMemo(() => groupStacks(visible), [visible]);

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
          <input
            className="stackmenu__search"
            type="search"
            placeholder="Find a stack"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <div className="stackmenu__list">
            {visible.length === 0 && <p className="stackmenu__empty">No stack matches “{query}”.</p>}
            {groups.map((group) => (
              <div key={group.key || 'other'}>
                <div className="stackmenu__group">
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
                      <span className="stackmenu__name">{stack?.label ?? key}</span>
                      <Glyph
                        severity={worst}
                        size={18}
                        className="stackmenu__worst"
                        label={stack?.evaluated === false ? 'not evaluated' : undefined}
                      />
                      <span className="stackmenu__count">{total}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
