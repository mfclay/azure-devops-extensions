/**
 * The Insights hub: the Azure DevOps host for ui, as `dev/src/main.tsx` is the local one.
 *
 * Order matters. `SDK.init()` must come before any other SDK call, which otherwise waits on the
 * handshake and hangs rather than throwing. `{ loaded: false }` holds Azure DevOps's spinner
 * until `notifyLoadSucceeded()`, which is sent once the page has painted its loading state.
 */
import { loadEstate, loadMetadata, loadRunStages, MemoryCache, withFacts, type LoadProgress, type Pipeline, type PipelineFacts } from '@pipeline-insights/core';
import { adoLinks, InsightsPage, LoadingPage, useRepoSearch, type About, type SetupFacts, type Theme } from '@pipeline-insights/ui';
import * as SDK from 'azure-devops-extension-sdk';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { AdoSource } from './ado-source.js';
import { ADO_THEME_KEYS, adoTheme, isDark, luminance, type AdoThemeData } from './ado-theme.js';

/** Unfinished runs are re-read this often while the page is visible. */
const REFRESH_MS = 60_000;

/** `CommonServiceIds`, a `const enum` in the API package, so it has no runtime value. */
const LOCATION_SERVICE = 'ms.vss-features.location-service';
const NAVIGATION_SERVICE = 'ms.vss-features.host-navigation-service';

interface LocationService {
  getServiceLocation(serviceInstanceType?: string, hostType?: number): Promise<string>;
}

interface NavigationService {
  getQueryParams(): Promise<Record<string, string>>;
  /** An empty value removes the parameter. */
  setQueryParams(parameters: Record<string, string>): void;
}

interface Host {
  collection: string;
  project: string;
  /** From `?folder=` in the hub's address, which the folder dropdown sets. */
  folder: string | null;
  navigation: NavigationService | null;
  about: About;
}

const log = (...args: unknown[]) => console.info('[pipeline-insights]', ...args);

interface AppliedTheme {
  data: AdoThemeData | undefined;
  dark: boolean;
}

/**
 * Whether the applied theme is dark, from the colours the browser resolves for Azure DevOps's
 * background and text, since a theme value may be a `var()` that only the browser can follow.
 */
function resolveDark(data: AdoThemeData | undefined): boolean {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;background-color:var(--background-color);color:var(--text-primary-color)';
  document.body.appendChild(probe);
  const { backgroundColor, color } = getComputedStyle(probe);
  probe.remove();
  const transparent = /^rgba\(.*,\s*0\)$|^transparent$/.test(backgroundColor);
  const bg = transparent ? null : luminance(backgroundColor);
  const fg = luminance(color);
  const dark = bg !== null ? bg < 0.4 : fg !== null ? fg > 0.5 : isDark(data);
  log('theme resolved:', { background: data?.['background-color'], backgroundColor, color, dark });
  return dark;
}

let applied: AppliedTheme = { data: undefined, dark: false };
const themeListeners = new Set<(theme: AppliedTheme) => void>();
// Registered before init(): the SDK applies the host theme during the handshake, and again on
// every theme change, firing `themeApplied` with the raw theme data each time.
window.addEventListener('themeApplied', (e) => {
  const data = (e as CustomEvent<AdoThemeData>).detail;
  const missing = ADO_THEME_KEYS.filter((k) => !data?.[k]);
  log('theme applied:', Object.keys(data ?? {}).length, 'variables; missing', missing.length ? missing : 'none');
  applied = { data, dark: resolveDark(data) };
  for (const listener of themeListeners) listener(applied);
});

function useAdoTheme(): Theme {
  const [theme, setTheme] = useState(applied);
  useEffect(() => {
    themeListeners.add(setTheme);
    setTheme(applied);
    return () => void themeListeners.delete(setTheme);
  }, []);
  return useMemo(() => adoTheme(theme.data, theme.dark), [theme]);
}

async function connect(): Promise<Host> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  const project = SDK.getWebContext().project.name;
  let collection: string;
  try {
    const location = await SDK.getService<LocationService>(LOCATION_SERVICE);
    collection = await location.getServiceLocation();
  } catch (err) {
    collection = `https://dev.azure.com/${SDK.getHost().name}/`;
    log('location service unavailable; using', collection, err);
  }
  let navigation: NavigationService | null = null;
  let folder: string | null = null;
  try {
    navigation = await SDK.getService<NavigationService>(NAVIGATION_SERVICE);
    const params = await navigation.getQueryParams();
    log('query params:', params);
    folder = params['folder'] || null;
  } catch (err) {
    log('navigation service unavailable', err);
  }
  // The Marketplace item, built from the running extension so no publisher is written down.
  const { publisherId, extensionId, version } = SDK.getExtensionContext();
  const about = { version, href: `https://marketplace.visualstudio.com/items?itemName=${publisherId}.${extensionId}` };
  log('version', version);
  return { collection, project, folder, navigation, about };
}

const message: CSSProperties = { padding: 32, color: 'var(--pi-muted)', fontFamily: 'var(--pi-font)', fontSize: 14 };

function Hub({ host }: { host: Host }) {
  const theme = useAdoTheme();
  const { source, cache, links } = useMemo(
    () => ({
      source: new AdoSource(host.collection, host.project, () => SDK.getAccessToken()),
      cache: new MemoryCache(),
      links: adoLinks(host.collection, host.project),
    }),
    [host],
  );
  const [estate, setEstate] = useState<{ pipelines: Pipeline[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [readingMetadata, setReadingMetadata] = useState(false);
  const [setup, setSetup] = useState<SetupFacts>({});
  const [metadataMs, setMetadataMs] = useState<number>();
  const loading = useRef(false);
  const loaded = useRef(false);
  // Read once per page, after the first paint, and reused by every refresh.
  const facts = useRef<Record<number, PipelineFacts> | null>(null);
  const metadataStarted = useRef(false);
  // The viewer's choice to search whole repos for metadata files, and the pipelines to read again for.
  const repoSearch = useRepoSearch();
  const searchRepos = useRef(repoSearch.on);
  const latest = useRef<Pipeline[] | null>(null);

  const loadFacts = useCallback(
    async (pipelines: Pipeline[]) => {
      const started = performance.now();
      setReadingMetadata(true);
      try {
        const m = await loadMetadata(source, cache, pipelines, { searchRepos: searchRepos.current });
        facts.current = m.facts;
        setEstate((e) => e && { ...e, pipelines: withFacts(e.pipelines, m.facts) });
        setSetup({ catalogs: m.catalogs, policiesRead: m.policiesRead });
        setMetadataMs(performance.now() - started);
        const sources: Record<string, number> = {};
        for (const f of Object.values(m.facts)) sources[f.purposeSource ?? 'none'] = (sources[f.purposeSource ?? 'none'] ?? 0) + 1;
        log(`read metadata in ${Math.round(performance.now() - started)} ms; purposes by source`, sources);
        log(m.policiesRead ? 'branch policies read' : 'branch policies unreadable; PR trigger lines dropped');
        const orphans = m.catalogs.flatMap((c) => c.orphans.map((path) => `${c.repo}: ${path}`));
        if (orphans.length) log('metadata entries that no pipeline uses:', orphans);
        for (const c of m.catalogs) if (c.problems.length) log(`problems in ${c.repo}/${c.path ?? '(none found)'}:`, c.problems);
      } catch (err) {
        metadataStarted.current = false;
        log('metadata load failed', err);
      } finally {
        setReadingMetadata(false);
      }
    },
    [source, cache],
  );

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    // The first load reports its progress to the loading page; later ones show only a spinner.
    const first = !loaded.current;
    if (!first) setRefreshing(true);
    const started = performance.now();
    try {
      const pipelines = await loadEstate(source, cache, {
        ...(facts.current ? { facts: facts.current } : {}),
        ...(first ? { onProgress: setProgress } : {}),
      });
      loaded.current = true;
      latest.current = pipelines;
      setEstate({ pipelines, at: Date.now() });
      setError(null);
      const runs = pipelines.reduce((n, p) => n + p.runs.length, 0);
      log(`read ${pipelines.length} pipelines and ${runs} runs in ${Math.round(performance.now() - started)} ms`);
      if (!metadataStarted.current) {
        metadataStarted.current = true;
        void loadFacts(pipelines);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      log('load failed', err);
    } finally {
      loading.current = false;
      setRefreshing(false);
    }
  }, [source, cache, loadFacts]);

  // Turning the search on or off reads the descriptions again; the runs stay as they are.
  useEffect(() => {
    if (searchRepos.current === repoSearch.on) return;
    searchRepos.current = repoSearch.on;
    if (latest.current && metadataStarted.current) void loadFacts(latest.current);
  }, [repoSearch.on, loadFacts]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Older runs are always finished: loadEstate fetches every unfinished run's timeline itself.
  const loadStages = useCallback((runId: number) => loadRunStages(source, cache, runId, true), [source, cache]);
  // Keeps the folder in the hub's address, so a bookmark or a shared link reopens it.
  const onFolderChange = useCallback(
    (folder: string | null) => {
      try {
        host.navigation?.setQueryParams({ folder: folder ?? '' });
      } catch (err) {
        log('could not set the folder in the address', err);
      }
    },
    [host],
  );
  const initialView = useMemo(() => ({ folder: host.folder }), [host]);

  return (
    <div style={{ ...theme, background: 'var(--pi-bg)', minHeight: '100vh' } as CSSProperties}>
      {estate ? (
        <InsightsPage
          estate={estate.pipelines}
          now={estate.at}
          project={host.project}
          links={links}
          loadStages={loadStages}
          readingMetadata={readingMetadata}
          refreshing={refreshing}
          initialView={initialView}
          onFolderChange={onFolderChange}
          setup={setup}
          repoSearch={repoSearch}
          about={host.about}
          {...(metadataMs !== undefined && { metadataMs })}
        />
      ) : error ? (
        <div style={message}>
          <p>Pipeline Insights could not read this project's pipelines.</p>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : (
        <LoadingPage project={host.project} progress={progress} />
      )}
      {estate && error && <p style={{ ...message, paddingTop: 0 }}>The last refresh failed: {error}</p>}
    </div>
  );
}

async function start() {
  const container = document.getElementById('root');
  if (!container) throw new Error('index.html has no #root element.');
  document.body.style.margin = '0';
  const host = await connect();
  createRoot(container).render(
    <StrictMode>
      <Hub host={host} />
    </StrictMode>,
  );
  await SDK.notifyLoadSucceeded();
}

start().catch((err) => {
  log('start failed', err);
  void SDK.notifyLoadFailed(err instanceof Error ? err : String(err));
});
