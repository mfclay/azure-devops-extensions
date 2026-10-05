/** @vitest-environment jsdom */
import { FixtureSource, loadEstate, loadMetadata, MemoryCache, withFacts, type Fixture, type Pipeline } from '@pipeline-insights/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoLinks, InsightsPage, LoadingPage, useRepoSearch } from '../src/index.js';

// The synthetic estate from core. Tests may import fixtures; nothing under src/ may.
import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;

/** jsdom here has no localStorage; the page copes without one, but the tests check what it keeps. */
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

let bare: Pipeline[];
let estate: Pipeline[];
beforeAll(async () => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
  const source = new FixtureSource(fixture);
  bare = await loadEstate(source, new MemoryCache());
  estate = withFacts(bare, (await loadMetadata(source, new MemoryCache(), bare)).facts);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const page = () =>
  render(<InsightsPage estate={estate} now={Date.parse(fixture.capturedAt)} project={fixture.project} links={adoLinks(fixture.org, fixture.project)} />);
const attention = () => within(screen.getByRole('region', { name: /Needs attention/ }));
const health = () => within(screen.getByRole('region', { name: 'Estate health' }));
const rows = () => screen.queryAllByRole('button', { name: / details$/ });
const lineHeads = () => screen.queryAllByRole('button', { name: / line$/ });
/** Opens a closed line, whose member rows are hidden until then. */
const openLine = (name: string) => {
  const head = screen.getByRole('button', { name: `${name} line` });
  if (head.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
};

describe('InsightsPage on the contoso estate', () => {
  it('leads with what needs attention, six at a time', () => {
    page();
    const items = attention().getAllByRole('listitem');
    expect(items).toHaveLength(7); // six items and "Show all"
    expect(items[0]?.textContent).toContain('model-retrain-run · Last run on main failed');
    expect(items[0]?.textContent).toContain('It is the only run on main. 8 newer runs from other branches, the latest succeeded.');
    expect(items[1]?.querySelector('.pi-stage-name')?.textContent).toBe('Ring-2 Production');
    expect(screen.getByRole('heading', { name: 'Needs attention 7' })).toBeTruthy();

    // The no-owner count is setup, so the setup panel carries it instead.
    fireEvent.click(attention().getByRole('button', { name: 'Show all 7' }));
    expect(attention().getAllByRole('listitem')).toHaveLength(8);
    expect(attention().queryByText(/have no owner/)).toBeNull();
    expect(attention().getByRole('button', { name: 'Show fewer' })).toBeTruthy();
  });

  it('counts the estate by state, and filters by one', () => {
    page();
    expect(health().getByRole('button', { name: '22 Healthy' })).toBeTruthy();
    expect(health().getByText('243')).toBeTruthy();

    fireEvent.click(health().getByRole('button', { name: '2 Failing' }));
    // Folder by folder: \in-development, then \tools. A line that matches shows all its members.
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'catalog-sync-etl-build details',
      'catalog-sync-etl-deploy details',
      'model-retrain-run details',
    ]);
    fireEvent.click(health().getByRole('button', { name: '2 Failing' }));
    // 33 pipelines, less the 9 in the four lines that need no attention and so stay closed.
    expect(lineHeads().filter((h) => h.getAttribute('aria-expanded') === 'false').map((h) => h.getAttribute('aria-label'))).toEqual([
      'file-import-app line',
      'pricing-app line',
      'db-tool line',
      'webapp-admin line',
    ]);
    expect(rows().length).toBe(24);
  });

  it('shows an archive folder like any other, and closes a folder by hand', () => {
    page();
    expect(screen.queryByRole('checkbox', { name: /archive/ })).toBeNull();
    const archive = screen.getByRole('button', { name: /^archive/ });
    expect(archive.getAttribute('aria-expanded')).toBe('true');
    expect(rows().length).toBe(24);
    fireEvent.click(archive);
    expect(rows().length).toBe(21);
  });

  it('lists archived and disabled pipelines last and quiet, and says what the counts leave out', () => {
    const marked = estate.map((p) => (p.name.startsWith('catalog-sync-etl') ? { ...p, facts: { ...p.facts, archived: true } } : p));
    render(<InsightsPage estate={marked} now={Date.parse(fixture.capturedAt)} project={fixture.project} links={adoLinks(fixture.org, fixture.project)} />);
    expect(health().getByRole('button', { name: '1 Failing' })).toBeTruthy();
    expect(health().getByText('Not counted: 2 archived and 1 disabled pipelines.')).toBeTruthy();
    expect(attention().queryByText(/catalog-sync-etl/)).toBeNull();
    // legacy-export-run is disabled in Azure DevOps.
    expect(screen.getByRole('button', { name: /^archive/ }).textContent).toContain('1 disabled');
    expect(screen.getByRole('button', { name: 'legacy-export-run details' }).className).toContain('pi-retired');

    openLine('catalog-sync-etl');
    fireEvent.click(screen.getByRole('button', { name: 'catalog-sync-etl-deploy details' }));
    const panel = within(screen.getByRole('dialog', { name: 'catalog-sync-etl-deploy' }));
    expect(panel.getByText('Archived in pipelines/pipelines.meta.yaml.')).toBeTruthy();
  });

  it('filters rows by name or purpose', () => {
    page();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter pipelines' }), { target: { value: 'webapp-storefront' } });
    expect(lineHeads().map((r) => r.getAttribute('aria-expanded'))).toEqual(['true']);
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'webapp-storefront-ci details',
      'webapp-storefront-build details',
      'webapp-storefront-deploy details',
    ]);
  });

  it('shows a line as one row, open when a member needs attention, and toggles it by hand', () => {
    page();
    expect(lineHeads()).toHaveLength(6);
    const etl = screen.getByRole('button', { name: 'catalog-sync-etl line' });
    expect(etl.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'catalog-sync-etl-build details' })).toBeTruthy();
    fireEvent.click(etl);
    expect(etl.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'catalog-sync-etl-build details' })).toBeNull();

    const db = screen.getByRole('button', { name: 'db-tool line' });
    expect(db.getAttribute('aria-expanded')).toBe('false');
    expect(within(db).getByText('ci, job-build')).toBeTruthy();
    expect(within(db).getByText('job-build also runs on pushes to Orders.Deployment')).toBeTruthy();
    fireEvent.click(db);
    expect(rows().map((r) => r.getAttribute('aria-label'))).toContain('db-tool-job-build details');
  });

  it('recomputes for another window', () => {
    page();
    expect(attention().queryByText(/Unreliable lately/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    // Seventh by priority, so behind "Show all".
    expect(attention().queryByText(/Unreliable lately/)).toBeNull();
    fireEvent.click(attention().getByRole('button', { name: 'Show all 8' }));
    expect(attention().getByText(/Unreliable lately/)).toBeTruthy();
    expect(health().getByText('runs, last 7 days')).toBeTruthy();
  });

  it('opens a side panel for a pipeline, and Escape closes it', () => {
    page();
    openLine('pricing-app');
    fireEvent.click(screen.getByRole('button', { name: 'pricing-app-deploy details' }));
    const panel = within(screen.getByRole('dialog', { name: 'pricing-app-deploy' }));
    expect(panel.getByText('pricing-app-build').tagName).toBe('B');
    expect(panel.getByRole('link', { name: 'Open in Pipelines' }).getAttribute('href')).toBe(
      'https://dev.azure.com/contoso/Platform/_build?definitionId=122',
    );
    expect(panel.getByRole('heading', { name: 'Recent runs on main' })).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks a drafted purpose and links to the file that holds it', () => {
    page();
    openLine('pricing-app');
    fireEvent.click(screen.getByRole('button', { name: 'pricing-app-deploy details' }));
    const panel = within(screen.getByRole('dialog', { name: 'pricing-app-deploy' }));
    expect(panel.getByText('draft').getAttribute('title')).toBe('Marked (TODO: verify) where it is written');
    expect(panel.getByText('not set')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Edit description' }).getAttribute('href')).toBe(
      'https://dev.azure.com/contoso/Platform/_git/Orders.Apps?path=/pipelines%2Fpipelines.meta.yaml',
    );
  });

  it("names a pipeline's line, and suggests what one signal alone links it to", () => {
    page();
    openLine('webapp-admin');
    fireEvent.click(screen.getByRole('button', { name: 'webapp-admin-deploy details' }));
    let panel = within(screen.getByRole('dialog', { name: 'webapp-admin-deploy' }));
    expect(panel.getByText('webapp-admin: ci, build → deploy')).toBeTruthy();
    expect(panel.queryByText(/Looks related/)).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'admin-app-ci details' }));
    panel = within(screen.getByRole('dialog', { name: 'admin-app-ci' }));
    expect(panel.getByText('Looks related to the db-tool line.')).toBeTruthy();
    expect(panel.getByText('Both CI triggers watch src/db-tool, but the names have different stems.')).toBeTruthy();
    expect(panel.queryByText('Line')).toBeNull();
  });

  it('marks a purpose read from the opening comment, and offers to add a description', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'devtools-ci details' }));
    const panel = within(screen.getByRole('dialog', { name: 'devtools-ci' }));
    expect(panel.getByText('derived')).toBeTruthy();
    // Its repo has no metadata file yet, so the link opens the folder to create it in.
    const add = panel.getByRole('link', { name: 'Add a description' });
    expect(add.getAttribute('href')).toBe('https://dev.azure.com/contoso/Platform/_git/Orders.Tools?path=/pipelines');
    expect(add.getAttribute('title')).toBe('Create pipelines.meta.yaml here');
  });

  it('opens the side panel from an attention item', () => {
    page();
    fireEvent.click(attention().getByRole('button', { name: 'config-sync-build' }));
    expect(screen.getByRole('dialog', { name: 'config-sync-build' })).toBeTruthy();
  });

  it("says which runs have stages when the host cannot load an older run's", () => {
    page();
    openLine('pricing-app');
    fireEvent.click(screen.getByRole('button', { name: 'pricing-app-deploy details' }));
    expect(screen.getByText('Stages are loaded for the newest run and any unfinished one.')).toBeTruthy();
  });

  it("loads older runs' stages when the side panel opens", async () => {
    const asked: number[] = [];
    const loadStages = async (runId: number) => {
      asked.push(runId);
      return runId % 2 ? null : [
        { name: `Build ${runId}`, state: 'completed', result: 'succeeded', waitingForApproval: false },
        { name: 'Deploy', state: 'completed', result: 'succeeded', waitingForApproval: false },
      ];
    };
    render(
      <InsightsPage
        estate={estate}
        now={Date.parse(fixture.capturedAt)}
        project={fixture.project}
        links={adoLinks(fixture.org, fixture.project)}
        loadStages={loadStages}
      />,
    );
    openLine('pricing-app');
    fireEvent.click(screen.getByRole('button', { name: 'pricing-app-deploy details' }));
    const panel = within(screen.getByRole('dialog', { name: 'pricing-app-deploy' }));
    const pipeline = estate.find((p) => p.name === 'pricing-app-deploy');
    const older = pipeline?.runs.filter((r) => r.branch === 'main' && r.stages === null).slice(0, 9) ?? [];
    expect(older.length).toBeGreaterThan(0);

    expect(panel.getAllByRole('status', { name: 'Loading stages' })).toHaveLength(older.length);
    const even = older.find((r) => r.id % 2 === 0);
    if (even) expect(await panel.findByText(`Build ${even.id} · succeeded`)).toBeTruthy();
    expect(asked.sort()).toEqual(older.map((r) => r.id).sort());
    expect(panel.queryByText('Stages are loaded for the newest run and any unfinished one.')).toBeNull();
    const odd = older.filter((r) => r.id % 2).length;
    if (odd) expect(await panel.findByText(`Stages could not be read for ${odd === 1 ? 'one run' : `${odd} runs`}.`)).toBeTruthy();
    expect(panel.queryAllByRole('status', { name: 'Loading stages' })).toHaveLength(0);
  });

  it('says when descriptions are still coming and when a refresh is under way', () => {
    const { rerender } = page();
    expect(screen.queryByRole('status')).toBeNull();
    const props = { estate, now: Date.parse(fixture.capturedAt), project: fixture.project, links: adoLinks(fixture.org, fixture.project) };
    rerender(<InsightsPage {...props} readingMetadata refreshing />);
    expect(screen.getByRole('status', { name: 'Refreshing' })).toBeTruthy();
    expect(screen.getByText('reading descriptions and lines')).toBeTruthy();
  });
});

describe('InsightsPage scoped to a folder', () => {
  const props = () => ({ estate, now: Date.parse(fixture.capturedAt), project: fixture.project, links: adoLinks(fixture.org, fixture.project) });
  const folderButton = () => screen.getByRole('button', { name: /^Folder: / });
  const subtitle = () => screen.getByText(/data as of/).textContent;

  it('picks a folder from the heading, and narrows everything to it and its subfolders', () => {
    const picked: (string | null)[] = [];
    render(<InsightsPage {...props()} onFolderChange={(f) => picked.push(f)} />);
    expect(folderButton().textContent).toBe('All folders');
    expect(subtitle()).toMatch(/^Platform · 33 pipelines · /);

    fireEvent.click(folderButton());
    const menu = within(screen.getByRole('menu', { name: 'Folders' }));
    expect(menu.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual([
      'All folders33',
      'archive3',
      'in-development2',
      'services10',
      'infrastructure2',
      'production8',
      'testing1',
      'tools17',
    ]);
    fireEvent.click(menu.getByRole('menuitemradio', { name: 'services, 10 pipelines' }));

    expect(picked).toEqual(['\\services']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(folderButton().textContent).toBe('services');
    expect(subtitle()).toMatch(/^Platform · 10 pipelines in services and its 2 subfolders · /);
    expect(screen.getAllByRole('button', { name: /^services \\ / }).map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
    expect(screen.queryByRole('button', { name: /^tools/ })).toBeNull();
    expect(attention().getAllByRole('listitem').map((i) => i.querySelector('button')?.textContent)).toEqual([
      'infra-stacks',
      'warehouse-region-east-deploy',
    ]);
    expect(health().getByRole('button', { name: '8 Healthy' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pipeline Insights' }));
    expect(picked).toEqual(['\\services', null]);
    expect(folderButton().textContent).toBe('All folders');
  });

  it('opens on a folder the host sets', () => {
    render(<InsightsPage {...props()} initialView={{ folder: '\\archive' }} />);
    expect(folderButton().textContent).toBe('archive');
    expect(rows()).toHaveLength(3);
  });

  it('closes the folder dropdown on Escape without picking', () => {
    const picked: (string | null)[] = [];
    render(<InsightsPage {...props()} onFolderChange={(f) => picked.push(f)} />);
    fireEvent.click(folderButton());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(picked).toEqual([]);
  });

  it('filters by repo, and offers no category or component on this estate', () => {
    render(<InsightsPage {...props()} />);
    expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Component' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Repo' }), { target: { value: 'Orders.Deployment' } });
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'infra-stacks details',
      'smoke-environment details',
      'config-sync-build details',
    ]);
    expect(subtitle()).toMatch(/^Platform · 3 pipelines · /);
  });
});

describe('the setup panel', () => {
  const panel = () => within(screen.getByRole('complementary', { name: 'Get more from Insights' }));
  const bar = () => panel().getByRole('button', { name: /^Get more from Insights/ });

  it('docks minimized, counts what is left to set up, and opens to say what each unlocks', () => {
    render(
      <InsightsPage
        estate={estate}
        now={Date.parse(fixture.capturedAt)}
        project={fixture.project}
        links={adoLinks(fixture.org, fixture.project)}
        setup={{ catalogs: [], policiesRead: true }}
        about={{ version: '0.1.8', href: 'https://marketplace.example/items?itemName=pub.ext' }}
        metadataMs={700}
      />,
    );
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    expect(panel().getByLabelText('5 to set up')).toBeTruthy();
    expect(panel().queryByText('Owners')).toBeNull();

    fireEvent.click(bar());
    expect(panel().getByText('Owners')).toBeTruthy();
    expect(panel().getByText('0 of 29 confirmed')).toBeTruthy();
    expect(panel().getByText('Branch policies readable')).toBeTruthy();
    expect(panel().getByText(/Pipeline Insights/).textContent).toBe('Pipeline Insights 0.1.8 · data read 18:30:00 UTC, descriptions 0.7 s after');
    expect(panel().getByRole('link', { name: 'About this extension ›' }).getAttribute('href')).toBe(
      'https://marketplace.example/items?itemName=pub.ext',
    );
    expect(window.localStorage.getItem('pipeline-insights.setup-open')).toBe('true');
  });

  it('remembers being left open', () => {
    window.localStorage.setItem('pipeline-insights.setup-open', 'true');
    page();
    expect(bar().getAttribute('aria-expanded')).toBe('true');
  });

  it("offers to search whole repos only when the host can, and remembers the viewer's choice", () => {
    window.localStorage.setItem('pipeline-insights.setup-open', 'true');
    page();
    expect(panel().queryByRole('checkbox')).toBeNull();
    cleanup();

    function Searchable() {
      const repoSearch = useRepoSearch();
      return (
        <InsightsPage estate={estate} now={Date.parse(fixture.capturedAt)} project={fixture.project} links={adoLinks(fixture.org, fixture.project)} repoSearch={repoSearch} />
      );
    }
    render(<Searchable />);
    const box = () => panel().getByRole('checkbox', { name: /^Search the whole repository for the metadata file/ }) as HTMLInputElement;
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(box().checked).toBe(true);
    expect(window.localStorage.getItem('pipeline-insights.search-repos')).toBe('true');
    cleanup();
    render(<Searchable />);
    expect(box().checked).toBe(true);
  });

  it('waits for the descriptions before counting anything', () => {
    window.localStorage.setItem('pipeline-insights.setup-open', 'true');
    render(<InsightsPage estate={bare} now={Date.parse(fixture.capturedAt)} project={fixture.project} links={adoLinks(fixture.org, fixture.project)} readingMetadata />);
    expect(panel().queryByLabelText(/to set up/)).toBeNull();
    expect(panel().getByText('Reading descriptions…')).toBeTruthy();
    expect(panel().getByText(/^data read/)).toBeTruthy();
  });
});

describe('LoadingPage', () => {
  it('counts pipelines once the definitions are read', () => {
    const { rerender } = render(<LoadingPage project="Platform" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Reading pipelines and their runs');
    rerender(<LoadingPage project="Platform" progress={{ pipelines: 33, ready: 12 }} />);
    expect(status.textContent).toBe('Reading pipelines and their runs12 of 33 pipelines');
  });
});
