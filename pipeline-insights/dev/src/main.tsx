import {
  FixtureSource,
  loadEstate,
  loadMetadata,
  MemoryCache,
  withFacts,
  type Fixture,
  type LoadProgress,
  type Pipeline,
  type PipelineSource,
} from '@pipeline-insights/core';
import type { SetupFacts } from '@pipeline-insights/ui';
import { adoLinks, darkTheme, InsightsPage, LoadingPage, lightTheme } from '@pipeline-insights/ui';
import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
// The synthetic estate. Only tests and this page import fixtures.
import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;
const CAPTURED = Date.parse(fixture.capturedAt);
const HOUR = 36e5;

type ThemeChoice = 'system' | 'light' | 'dark';

/** `?folder=\services` opens on a folder, as the hub's address does; picking one updates it. */
const initialFolder = new URLSearchParams(location.search).get('folder');

function setFolderInAddress(folder: string | null) {
  const params = new URLSearchParams(location.search);
  if (folder) params.set('folder', folder);
  else params.delete('folder');
  const search = params.toString();
  history.replaceState(null, '', search ? `?${search}` : location.pathname);
}

/** The fixture with every read held back, so the loading states can be seen. */
function slowed(source: PipelineSource, ms: number): PipelineSource {
  const later = <T,>(value: Promise<T>) => new Promise<T>((done) => setTimeout(() => done(value), ms * (0.5 + Math.random())));
  return {
    definitions: () => later(source.definitions()),
    runs: (ids, n) => later(source.runs(ids, n)),
    timeline: (id) => later(source.timeline(id)),
    buildValidationPolicies: () => later(source.buildValidationPolicies()),
    listFolder: (repo, folder, branch) => later(source.listFolder(repo, folder, branch)),
    readFile: (repo, id) => later(source.readFile(repo, id)),
  };
}

function useSystemDark() {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return dark;
}

const bar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px 16px',
  alignItems: 'center',
  padding: '8px 32px',
  borderBottom: '1px dashed var(--pi-line-strong)',
  background: 'var(--pi-surface)',
  color: 'var(--pi-muted)',
  font: '12.5px/1.4 var(--pi-font)',
};

function DevPage() {
  const [estate, setEstate] = useState<Pipeline[] | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [readingMetadata, setReadingMetadata] = useState(false);
  const [setup, setSetup] = useState<SetupFacts>({});
  const [metadataMs, setMetadataMs] = useState<number>();
  const [slowRun, setSlowRun] = useState(0);
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [now, setNow] = useState(CAPTURED);
  const systemDark = useSystemDark();

  // As the hub does: the run status paints first, then the metadata fills in.
  // "Reload slowly" bumps slowRun, which reads it all again with each read held back.
  useEffect(() => {
    const fixtureSource = new FixtureSource(fixture);
    const source = slowRun ? slowed(fixtureSource, 400) : fixtureSource;
    const cache = new MemoryCache();
    let live = true;
    setEstate(null);
    setProgress(null);
    (async () => {
      const bare = await loadEstate(source, cache, { concurrency: 4, onProgress: (p) => live && setProgress(p) });
      if (!live) return;
      setEstate(bare);
      setReadingMetadata(true);
      const started = performance.now();
      const { facts, catalogs, policiesRead } = await loadMetadata(source, cache, bare);
      if (!live) return;
      setEstate(withFacts(bare, facts));
      setSetup({ catalogs, policiesRead });
      setMetadataMs(performance.now() - started);
      setReadingMetadata(false);
    })().catch(console.error);
    return () => {
      live = false;
    };
  }, [slowRun]);

  const dark = choice === 'dark' || (choice === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  const shift = (hours: number) => setNow((n) => n + hours * HOUR);

  return (
    <div style={{ ...(dark ? darkTheme : lightTheme), background: 'var(--pi-bg)', minHeight: '100vh' } as CSSProperties}>
      <div style={bar}>
        <strong style={{ color: 'var(--pi-fg)' }}>Dev page.</strong>
        <span>
          Synthetic estate as of {new Date(CAPTURED).toUTCString()}, not live.
        </span>
        <label>
          Theme{' '}
          <select value={choice} onChange={(e) => setChoice(e.target.value as ThemeChoice)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <span>
          Now: {now === CAPTURED ? 'capture time' : `${((now - CAPTURED) / HOUR / 24).toFixed(1)} days after capture`}{' '}
          <button type="button" onClick={() => shift(-24)}>
            −1 day
          </button>{' '}
          <button type="button" onClick={() => shift(24)}>
            +1 day
          </button>{' '}
          <button type="button" onClick={() => shift(24 * 7)}>
            +1 week
          </button>{' '}
          <button type="button" disabled={now === CAPTURED} onClick={() => setNow(CAPTURED)}>
            Reset
          </button>
        </span>
        <button type="button" onClick={() => setSlowRun((n) => n + 1)}>
          Reload slowly
        </button>
      </div>
      {estate ? (
        <InsightsPage
          estate={estate}
          now={now}
          project={fixture.project}
          links={adoLinks(fixture.org, fixture.project)}
          readingMetadata={readingMetadata}
          initialView={{ folder: initialFolder }}
          onFolderChange={setFolderInAddress}
          setup={setup}
          about={{ version: 'dev page' }}
          {...(metadataMs !== undefined && { metadataMs })}
        />
      ) : (
        <LoadingPage project={fixture.project} progress={progress} />
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element.');

createRoot(container).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
);
