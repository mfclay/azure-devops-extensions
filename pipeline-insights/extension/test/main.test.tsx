/** @vitest-environment jsdom */
import * as core from '@pipeline-insights/core';
import { FixtureSource, type Fixture, type PipelineSource } from '@pipeline-insights/core';
import { darkTheme, lightTheme } from '@pipeline-insights/ui';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The synthetic estate stands in for the project. Tests may import fixtures; nothing under src/ may.
import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;
const LOCATION = 'ms.vss-features.location-service';
const NAVIGATION = 'ms.vss-features.host-navigation-service';

/**
 * main.tsx is the hub's entry point: it starts on import. Each test sets up the host it wants in
 * `host`, then imports a fresh copy of the module with `start()`.
 */
const host = vi.hoisted(() => ({
  calls: [] as string[],
  init: null as Error | null,
  location: null as Error | null,
  navigation: null as Error | null,
  query: {} as Record<string, string>,
  setQueryParams: (_: Record<string, string>) => {},
  /** Makes the estate's definitions read fail while it is set. */
  failEstate: null as Error | null,
  failMetadata: null as Error | null,
  sources: [] as { collection: string; project: string }[],
}));

vi.mock('azure-devops-extension-sdk', () => ({
  init: vi.fn(async (options: unknown) => {
    host.calls.push(`init ${JSON.stringify(options)}`);
    if (host.init) throw host.init;
  }),
  ready: vi.fn(async () => void host.calls.push('ready')),
  getWebContext: () => ({ project: { name: 'Platform' } }),
  getHost: () => ({ name: 'contoso' }),
  getExtensionContext: () => ({ publisherId: 'fabrikam', extensionId: 'pipeline-insights', version: '1.2.3' }),
  getService: vi.fn(async (id: string) => {
    if (id === LOCATION) {
      if (host.location) throw host.location;
      return { getServiceLocation: async () => 'https://tfs.contoso.test/DefaultCollection/' };
    }
    if (id === NAVIGATION) {
      if (host.navigation) throw host.navigation;
      return { getQueryParams: async () => host.query, setQueryParams: (p: Record<string, string>) => host.setQueryParams(p) };
    }
    throw new Error(`no service ${id}`);
  }),
  notifyLoadSucceeded: vi.fn(async () => void host.calls.push('loaded')),
  notifyLoadFailed: vi.fn(async (err: unknown) => void host.calls.push(`failed ${err instanceof Error ? err.message : String(err)}`)),
  getAccessToken: vi.fn(async () => 'tok'),
}));

vi.mock('../src/source.js', () => ({
  hubSource: (collection: string, project: string): PipelineSource => {
    host.sources.push({ collection, project });
    const inner = new FixtureSource(fixture);
    return {
      definitions: () => (host.failEstate ? Promise.reject(host.failEstate) : inner.definitions()),
      runs: (ids, n) => inner.runs(ids, n),
      timeline: (id) => inner.timeline(id),
      buildValidationPolicies: () => inner.buildValidationPolicies(),
      listFolder: (repo, folder, branch) => inner.listFolder(repo, folder, branch),
      readFile: (repo, id) => inner.readFile(repo, id),
    };
  },
}));

vi.mock('@pipeline-insights/core', async (original) => {
  const real = await original<typeof core>();
  return {
    ...real,
    loadMetadata: vi.fn((...args: Parameters<typeof real.loadMetadata>) =>
      host.failMetadata ? Promise.reject(host.failMetadata) : real.loadMetadata(...args),
    ),
  };
});

/** jsdom here has no localStorage; the repo-search setting keeps its choice in one. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
  document.body.innerHTML = '<div id="root"></div>';
  Object.assign(host, {
    calls: [],
    init: null,
    location: null,
    navigation: null,
    query: {},
    setQueryParams: () => {},
    failEstate: null,
    failMetadata: null,
    sources: [],
  });
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(core.loadMetadata).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = () => import('../src/main.js');
const logged = (text: string) => info.mock.calls.some((args: unknown[]) => args.some((a) => String(a).includes(text)));
const page = () => screen.findByRole('heading', { name: /^Needs attention/ }, { timeout: 5000 });
/** The element main.tsx wraps the page in, which carries the theme's variables. */
const themed = () => document.getElementById('root')!.firstElementChild as HTMLElement;
const themeApplied = (detail: Record<string, string>) =>
  act(() => void window.dispatchEvent(new CustomEvent('themeApplied', { detail })));

const lightData = { 'background-color': 'rgba(255, 255, 255, 1)', 'text-primary-color': 'rgba(0, 0, 0, .9)' };
const darkData = { 'background-color': 'rgba(32, 31, 30, 1)', 'text-primary-color': 'rgba(255, 255, 255, .9)' };

describe('the hub entry point', () => {
  it('finishes the handshake before anything else, and holds the spinner until the page has painted', async () => {
    await start();
    await waitFor(() => expect(host.calls).toContain('loaded'));
    expect(host.calls).toEqual(['init {"loaded":false,"applyTheme":true}', 'ready', 'loaded']);
    // The loading page is up by the time Azure DevOps drops its spinner.
    expect(screen.getByRole('heading', { name: 'Pipeline Insights' })).toBeTruthy();
    await page();
  });

  it('reads the project the hub is open in, from the collection the location service names', async () => {
    await start();
    await page();
    // StrictMode builds the memo twice in a test build; every source is the same one.
    expect(new Set(host.sources.map((s) => JSON.stringify(s)))).toEqual(
      new Set([JSON.stringify({ collection: 'https://tfs.contoso.test/DefaultCollection/', project: 'Platform' })]),
    );
    const link = document.querySelector<HTMLAnchorElement>('a[href*="_build/results?buildId="]');
    expect(link?.href).toMatch(/^https:\/\/tfs\.contoso\.test\/DefaultCollection\/Platform\/_build\/results\?buildId=\d+$/);
  });

  it('falls back to the dev.azure.com address when the location service is unavailable', async () => {
    host.location = new Error('no location service');
    await start();
    await page();
    expect(host.sources[0]?.collection).toBe('https://dev.azure.com/contoso/');
    expect(logged('location service unavailable')).toBe(true);
  });

  it('links the Marketplace item from the running extension, never a written-down publisher', async () => {
    await start();
    await page();
    fireEvent.click(screen.getByRole('button', { name: /Get more from Insights/ }));
    const about = screen.getByRole('link', { name: /About this extension/ }) as HTMLAnchorElement;
    expect(about.href).toBe('https://marketplace.visualstudio.com/items?itemName=fabrikam.pipeline-insights');
    expect(screen.getByRole('complementary', { name: 'Get more from Insights' }).textContent).toContain('Pipeline Insights 1.2.3');
  });

  it('reports a failed handshake to Azure DevOps rather than hanging', async () => {
    host.init = new Error('handshake refused');
    await start();
    await waitFor(() => expect(host.calls).toContain('failed handshake refused'));
    expect(host.calls).not.toContain('loaded');
    expect(document.getElementById('root')!.childElementCount).toBe(0);
  });

  it('reports a page with no #root as a failed load', async () => {
    document.body.innerHTML = '';
    await start();
    await waitFor(() => expect(host.calls).toContain('failed index.html has no #root element.'));
    expect(host.calls.some((c) => c.startsWith('init'))).toBe(false);
  });
});

describe('the folder in the address', () => {
  it('opens on the folder named in ?folder=, and writes the choice back', async () => {
    host.query = { folder: '\\archive' };
    const set = vi.fn();
    host.setQueryParams = set;
    await start();
    await page();
    const picker = screen.getByRole('button', { name: /^Folder: / });
    expect(picker.getAttribute('aria-label')).toBe('Folder: archive');
    fireEvent.click(picker);
    fireEvent.click(within(screen.getByRole('menu', { name: 'Folders' })).getAllByRole('menuitemradio')[0]!);
    expect(set).toHaveBeenLastCalledWith({ folder: '' });
  });

  it('opens on every folder when the navigation service is unavailable', async () => {
    host.navigation = new Error('no navigation service');
    await start();
    await page();
    expect(screen.getByRole('button', { name: /^Folder: / }).getAttribute('aria-label')).toBe('Folder: All folders');
    expect(logged('navigation service unavailable')).toBe(true);
  });

  it('keeps the page up when the address cannot be written', async () => {
    host.setQueryParams = () => {
      throw new Error('navigation refused');
    };
    await start();
    await page();
    fireEvent.click(screen.getByRole('button', { name: /^Folder: / }));
    const items = within(screen.getByRole('menu', { name: 'Folders' })).getAllByRole('menuitemradio');
    fireEvent.click(items[1]!);
    expect(logged('could not set the folder in the address')).toBe(true);
    expect(screen.getByRole('heading', { name: /^Needs attention/ })).toBeTruthy();
  });
});

describe('loading and refreshing', () => {
  it('says why the first load failed, and tries again when asked', async () => {
    host.failEstate = new Error('HTTP 401');
    await start();
    expect(await screen.findByText("Pipeline Insights could not read this project's pipelines.")).toBeTruthy();
    expect(screen.getByText('HTTP 401')).toBeTruthy();
    host.failEstate = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await page();
    expect(screen.queryByText('HTTP 401')).toBeNull();
  });

  it('re-reads the estate every minute while the page is visible, and keeps it when a refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await start();
    await page();
    await waitFor(() => expect(core.loadMetadata).toHaveBeenCalledTimes(1));

    host.failEstate = new Error('HTTP 503');
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(await screen.findByText('The last refresh failed: HTTP 503')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Needs attention/ })).toBeTruthy();

    host.failEstate = null;
    await act(async () => void vi.advanceTimersByTime(60_000));
    await waitFor(() => expect(screen.queryByText(/The last refresh failed/)).toBeNull());
    // The descriptions are read once per page, not on every refresh.
    expect(core.loadMetadata).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a hidden page', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const definitions = vi.spyOn(FixtureSource.prototype, 'definitions');
    await start();
    await page();
    const reads = definitions.mock.calls.length;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(definitions.mock.calls.length).toBe(reads);
    visibility.mockReturnValue('visible');
    await act(async () => void vi.advanceTimersByTime(60_000));
    await waitFor(() => expect(definitions.mock.calls.length).toBe(reads + 1));
  });

  it('shows the runs when the descriptions cannot be read, and reads them again on the next refresh', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    host.failMetadata = new Error('policies unreadable');
    await start();
    await page();
    await waitFor(() => expect(logged('metadata load failed')).toBe(true));
    host.failMetadata = null;
    await act(async () => void vi.advanceTimersByTime(60_000));
    await waitFor(() => expect(core.loadMetadata).toHaveBeenCalledTimes(2));
  });

  it('reads the descriptions again, searching whole repos, when the viewer turns the search on', async () => {
    await start();
    await page();
    await waitFor(() => expect(core.loadMetadata).toHaveBeenCalledTimes(1));
    expect(vi.mocked(core.loadMetadata).mock.calls[0]?.[3]).toEqual({ searchRepos: false });
    fireEvent.click(screen.getByRole('button', { name: /Get more from Insights/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Search the whole repository/ }));
    await waitFor(() => expect(core.loadMetadata).toHaveBeenCalledTimes(2));
    expect(vi.mocked(core.loadMetadata).mock.calls[1]?.[3]).toEqual({ searchRepos: true });
  });
});

describe('the Azure DevOps theme', () => {
  it("uses ui's light palette until the host applies a theme", async () => {
    await start();
    await page();
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(lightTheme['--pi-wait']);
  });

  it('follows a theme change after the page is up', async () => {
    await start();
    await page();
    themeApplied(darkData);
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(darkTheme['--pi-wait']);
    themeApplied(lightData);
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(lightTheme['--pi-wait']);
  });

  it('applies a theme that arrived during the handshake, before the page mounted', async () => {
    await start();
    themeApplied(darkData);
    await page();
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(darkTheme['--pi-wait']);
  });

  /** The colours the browser resolved for Azure DevOps's background and text. */
  const resolved = (backgroundColor: string, color: string) =>
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundColor, color } as CSSStyleDeclaration);

  it("judges dark by the background the browser resolved, over the theme's own values", async () => {
    await start();
    await page();
    resolved('rgb(20, 20, 20)', 'rgb(250, 250, 250)');
    themeApplied(lightData);
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(darkTheme['--pi-wait']);
  });

  it('judges by the resolved text when the background is transparent', async () => {
    await start();
    await page();
    resolved('rgba(0, 0, 0, 0)', 'rgb(250, 250, 250)');
    themeApplied(lightData);
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(darkTheme['--pi-wait']);
    resolved('transparent', 'rgb(10, 10, 10)');
    themeApplied(darkData);
    expect(themed().style.getPropertyValue('--pi-wait')).toBe(lightTheme['--pi-wait']);
  });

  it('logs which theme variables the host left out', async () => {
    await start();
    await page();
    themeApplied(lightData);
    expect(info.mock.calls.some((args: unknown[]) => args[1] === 'theme applied:' && Array.isArray(args[4]) && args[4].length > 0)).toBe(true);
  });
});
