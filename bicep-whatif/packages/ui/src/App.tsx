import type { Severity } from '@bicep-whatif/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BuildNotes } from './components/BuildNotes.js';
import { DetailPanel } from './components/DetailPanel.js';
import { DiagnosticsBanner } from './components/DiagnosticsBanner.js';
import { NotEvaluatedBanner } from './components/NotEvaluatedBanner.js';
import { ResultsGrid } from './components/ResultsGrid.js';
import { SummaryStrip } from './components/SummaryStrip.js';
import { Toolbar } from './components/Toolbar.js';
import type { LoadResult, WhatIfSource } from './data/source.js';
import { buildEstateView, type EstateView } from './model/estate.js';
import { decodeViewState, encodeViewState } from './model/urlState.js';
import {
  applyFilters,
  countsForStrip,
  defaultViewState,
  setStacks,
  toggleSeverity,
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

  const selectedRow = useMemo(
    () => (state.selected === null ? undefined : allRows.find((r) => r.key === state.selected)),
    [allRows, state.selected],
  );
  const selectedStack = useMemo(
    () => estate?.stacks.find((s) => s.key === selectedRow?.stackKey),
    [estate, selectedRow],
  );

  const onSelect = useCallback((key: string) => {
    setState((s) => ({ ...s, selected: s.selected === key ? null : key }));
  }, []);
  const onClose = useCallback(() => {
    setState((s) => ({ ...s, selected: null }));
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
  const onReset = useCallback(() => {
    setState(defaultViewState());
  }, []);

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

  return (
    <div className="app">
      <NotEvaluatedBanner stacks={load.estate.stacks} />
      <DiagnosticsBanner stacks={load.estate.stacks} />
      <BuildNotes notes={load.result.notes} />

      <SummaryStrip
        buildLabel={load.result.buildLabel}
        stackCount={load.estate.stacks.length}
        evaluatedCount={load.estate.stacks.filter((s) => s.evaluated).length}
        resourceCount={load.estate.total}
        counts={stripCounts}
        potentialCounts={potentialCounts}
        active={state.severities}
        onToggle={onToggleSeverity}
      />

      <Toolbar
        stacks={load.estate.stacks}
        selectedStacks={state.stacks}
        query={state.query}
        hideNoise={state.hideNoise}
        shown={rows.length}
        total={allRows.length}
        onQuery={onQuery}
        onStacks={onStacks}
        onHideNoise={onHideNoise}
        onReset={onReset}
      />

      <div className="app__body">
        <div className="app__grid">
          <ResultsGrid rows={rows} selected={state.selected} onSelect={onSelect} onReset={onReset} />
        </div>
        {selectedRow && (
          <DetailPanel
            row={selectedRow}
            stack={selectedStack}
            hideNoise={state.hideNoise}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
