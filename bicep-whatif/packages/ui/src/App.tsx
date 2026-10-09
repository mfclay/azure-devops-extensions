import type { Severity } from '@bicep-whatif/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BuildNotes } from './components/BuildNotes.js';
import { Headline } from './components/Headline.js';
import { ResourceRows } from './components/ResourceRows.js';
import { StackList } from './components/StackList.js';
import { Toolbar } from './components/Toolbar.js';
import { Totals } from './components/Totals.js';
import type { LoadResult, WhatIfSource } from './data/source.js';
import { buildEstateView, type EstateView, type GridRow } from './model/estate.js';
import { headlineFor, summaryGroups } from './model/summary.js';
import { decodeViewState, encodeViewState } from './model/urlState.js';
import {
  applyFilters,
  countsForStrip,
  defaultViewState,
  setStacks,
  setStacksOpen,
  toggleRow,
  toggleSeverity,
  toggleStackOpen,
  type Layout,
  type ViewState,
} from './model/view.js';
import type { Navigation } from './nav/navigation.js';

export interface AppProps {
  source: WhatIfSource;
  navigation: Navigation;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: LoadResult; estate: EstateView };

/** Resource rows by stack, in the order given. Stage placeholders are the stack line's job. */
function byStack(rows: readonly GridRow[]): Map<string, GridRow[]> {
  const out = new Map<string, GridRow[]>();
  for (const row of rows) {
    if (row.isStagePlaceholder) continue;
    const list = out.get(row.stackKey);
    if (list) list.push(row);
    else out.set(row.stackKey, [row]);
  }
  return out;
}

export function App(props: AppProps): React.ReactElement {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [state, setState] = useState<ViewState>(defaultViewState);

  // Set while writing our own hash, so the change we caused does not bounce back
  // through the subscription and clobber the state that produced it.
  const writing = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await props.source.load();
        if (!live) return;
        setLoad({ status: 'ready', result, estate: buildEstateView(result.stages) });
      } catch (err) {
        if (!live) return;
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [props.source]);

  // Adopt whatever the URL says on open, and follow it if the host changes it.
  useEffect(() => {
    let live = true;
    void props.navigation.getHash().then((hash) => {
      if (live && hash.length > 0) setState(decodeViewState(hash));
    });
    const unsubscribe = props.navigation.subscribe((hash) => {
      if (writing.current) return;
      setState(decodeViewState(hash));
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [props.navigation]);

  useEffect(() => {
    writing.current = true;
    props.navigation.setHash(encodeViewState(state));
    const id = window.setTimeout(() => {
      writing.current = false;
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [state, props.navigation]);

  const estate = load.status === 'ready' ? load.estate : undefined;
  const allRows = useMemo(() => estate?.rows ?? [], [estate]);
  const rows = useMemo(() => applyFilters(allRows, state), [allRows, state]);
  const stripCounts = useMemo(() => countsForStrip(allRows, state), [allRows, state]);
  const potentialCounts = useMemo(
    () => countsForStrip(allRows, state, (row) => row.potential),
    [allRows, state],
  );
  const allStackKeys = useMemo(() => estate?.stacks.map((s) => s.key) ?? [], [estate]);
  const stacksByKey = useMemo(() => new Map(estate?.stacks.map((s) => [s.key, s]) ?? []), [estate]);
  const allRowsByStack = useMemo(() => byStack(allRows), [allRows]);
  const rowsByStack = useMemo(() => byStack(rows), [rows]);

  // A stack is listed when any of its rows passes the filters; a stage that
  // never ran passes through its placeholder row, so the default view keeps it.
  const visibleStacks = useMemo(() => {
    const keys = new Set(rows.map((r) => r.stackKey));
    return estate?.stacks.filter((s) => keys.has(s.key)) ?? [];
  }, [estate, rows]);
  const groups = useMemo(() => summaryGroups(visibleStacks), [visibleStacks]);

  // Searching opens every stack with a match, or a hit would sit behind a
  // closed line. Otherwise a stack is open if it was opened, or holds an open
  // row (which is how a shared link to one resource lands on it).
  const searching = state.query.trim().length > 0;
  const openStacks = useMemo(() => {
    if (searching) return new Set(visibleStacks.map((s) => s.key));
    const out = new Set(state.openStacks);
    for (const row of allRows) if (state.open.has(row.key)) out.add(row.stackKey);
    return out;
  }, [searching, visibleStacks, state.openStacks, state.open, allRows]);

  const headline = useMemo(
    () => (load.status === 'ready' ? headlineFor(load.estate, load.result.buildLabel) : undefined),
    [load],
  );

  const onToggleRow = useCallback((key: string) => {
    setState((s) => toggleRow(s, key));
  }, []);
  const onToggleStack = useCallback(
    (key: string) => {
      const rowKeys = (allRowsByStack.get(key) ?? []).map((r) => r.key);
      setState((s) => toggleStackOpen(s, key, openStacks.has(key), rowKeys));
    },
    [allRowsByStack, openStacks],
  );
  const onExpandAll = useCallback(
    (expand: boolean) => {
      setState((s) => setStacksOpen(s, expand ? visibleStacks.map((v) => v.key) : []));
    },
    [visibleStacks],
  );
  const onShowUnchanged = useCallback(() => {
    setState((s) => (s.severities.has('noChange') ? s : toggleSeverity(s, 'noChange')));
  }, []);
  const onToggleSeverity = useCallback((severity: Severity) => {
    setState((s) => toggleSeverity(s, severity));
  }, []);
  const onStacks = useCallback(
    (keys: string[]) => {
      setState((s) => setStacks(s, keys, allStackKeys));
    },
    [allStackKeys],
  );
  const onQuery = useCallback((query: string) => {
    setState((s) => ({ ...s, query }));
  }, []);
  const onHideNoise = useCallback((hideNoise: boolean) => {
    setState((s) => ({ ...s, hideNoise }));
  }, []);
  const onLayout = useCallback((layout: Layout) => {
    setState((s) => ({ ...s, layout }));
  }, []);
  const onReset = useCallback(() => {
    setState(defaultViewState());
  }, []);

  // Bring a linked resource into view once, when the tab first has both the
  // data and the link. Later clicks never scroll the page out from under you.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || load.status !== 'ready' || state.open.size === 0) return;
    scrolled.current = true;
    const target = [...document.querySelectorAll<HTMLElement>('[data-row-key]')].find((el) =>
      state.open.has(el.dataset.rowKey ?? ''),
    );
    target?.scrollIntoView?.({ block: 'start' });
  }, [load.status, state.open]);

  if (load.status === 'loading') {
    return (
      <div className="center">
        <p>Reading what-if results…</p>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="center">
        <h1>This tab could not read the build&rsquo;s what-if results.</h1>
        <p>{load.message}</p>
        <p>
          To work offline against the committed fixtures, open this page with <code>?mock=1</code>.
        </p>
      </div>
    );
  }

  const hasStacks = load.estate.stacks.length > 0;

  return (
    <div className="app">
      <BuildNotes notes={load.result.notes} />

      {headline && (
        <header className="summary">
          <Headline headline={headline} />
          <Totals
            counts={stripCounts}
            potentialCounts={potentialCounts}
            active={state.severities}
            onToggle={onToggleSeverity}
          />
        </header>
      )}

      {hasStacks && (
        <Toolbar
          stacks={load.estate.stacks}
          selectedStacks={state.stacks}
          query={state.query}
          hideNoise={state.hideNoise}
          shown={rows.length}
          total={allRows.length}
          layout={state.layout}
          anyOpen={openStacks.size > 0}
          onLayout={onLayout}
          onExpandAll={onExpandAll}
          onQuery={onQuery}
          onStacks={onStacks}
          onHideNoise={onHideNoise}
          onReset={onReset}
        />
      )}

      {hasStacks && (
        <main className="app__main">
          {rows.length === 0 ? (
            <div className="empty">
              <p>Nothing matches these filters.</p>
              <button type="button" className="btn" onClick={onReset}>
                Show everything
              </button>
            </div>
          ) : state.layout === 'stacks' ? (
            <StackList
              groups={groups}
              rowsByStack={rowsByStack}
              allRowsByStack={allRowsByStack}
              stacks={stacksByKey}
              openStacks={openStacks}
              openRows={state.open}
              hideNoise={state.hideNoise}
              unchangedHidden={!state.severities.has('noChange')}
              onToggleStack={onToggleStack}
              onToggleRow={onToggleRow}
              onShowUnchanged={onShowUnchanged}
            />
          ) : (
            <div className="flat">
              <div className="flat__head" aria-hidden="true">
                <span />
                <span />
                <span>Resource</span>
                <span>Stack</span>
                <span className="cell--type">Type</span>
                <span>Change</span>
              </div>
              <ResourceRows
                rows={rows}
                open={state.open}
                stacks={stacksByKey}
                hideNoise={state.hideNoise}
                withStack
                onToggle={onToggleRow}
              />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
