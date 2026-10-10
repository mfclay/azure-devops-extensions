import { SEVERITIES, type Severity } from '@bicep-whatif/core';
import { useCallback, useRef, useState } from 'react';
import { isDefaultSeveritySet, SEVERITY_PICKS } from '../model/view.js';
import { Glyph, SEVERITY_LABEL } from './Glyph.js';
import { useDismiss } from './useDismiss.js';

/** Most severe first, as the totals line and the stack list's columns run. */
const RUNGS: readonly Severity[] = [...SEVERITIES].reverse();

export interface ChangesFilterMenuProps {
  /** Resources per kind, as the totals line counts them. */
  counts: Record<Severity, number>;
  selected: ReadonlySet<Severity>;
  onChange: (severities: Severity[]) => void;
}

/**
 * The severity filter, beside the stack filter in the toolbar.
 *
 * It used to be the totals line itself: each count was a toggle, on by
 * default, so a click hid that kind of change. Counts that change colour on
 * hover read as links that go *to* those changes, which is the opposite, and
 * people clicked "protection loss" expecting to see only that. So the counts
 * now just report, and filtering is a menu that says what it does: a checkbox
 * per kind, and quick picks.
 */
export function ChangesFilterMenu(props: ChangesFilterMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, close, root);

  const toggle = (rung: Severity): void => {
    const next = new Set(props.selected);
    if (next.has(rung)) next.delete(rung);
    else next.add(rung);
    props.onChange(RUNGS.filter((r) => next.has(r)));
  };

  return (
    <div className="stackmenu" ref={root}>
      <button
        type="button"
        className="btn"
        data-active={!isDefaultSeveritySet(props.selected)}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Changes ({props.selected.size} of {RUNGS.length}) ▾
      </button>

      {open && (
        <div className="stackmenu__panel stackmenu__panel--narrow">
          <div className="stackmenu__top">
            <div className="stackmenu__quick" role="group" aria-label="Quick picks">
              <span className="muted">Quick:</span>
              {SEVERITY_PICKS.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    props.onChange([...pick.severities]);
                  }}
                >
                  {pick.label}
                </button>
              ))}
            </div>
          </div>
          <div className="stackmenu__list">
            {RUNGS.map((rung) => {
              const on = props.selected.has(rung);
              return (
                <button
                  key={rung}
                  type="button"
                  className="stackmenu__item"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => {
                    toggle(rung);
                  }}
                >
                  <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                  <Glyph severity={rung} size={18} className="stackmenu__worst" decorative />
                  <span className="stackmenu__who">
                    <span className="stackmenu__label">{SEVERITY_LABEL[rung]}</span>
                  </span>
                  <span className="stackmenu__count">{props.counts[rung]}</span>
                </button>
              );
            })}
          </div>
          <p className="stackmenu__note">A stack that wasn&rsquo;t evaluated always shows, whatever is picked here.</p>
        </div>
      )}
    </div>
  );
}
