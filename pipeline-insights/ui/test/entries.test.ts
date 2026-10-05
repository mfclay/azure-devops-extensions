import {
  FixtureSource,
  inferLines,
  loadEstate,
  loadMetadata,
  MemoryCache,
  pipelineState,
  withFacts,
  type Fixture,
  type Pipeline,
  type PipelineAnalysis,
} from '@pipeline-insights/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { folderEntries, isLineOpen, type FolderEntry } from '../src/entries.js';

import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;
const options = { windowDays: 14 as const, mainOnly: true, now: Date.parse(fixture.capturedAt) };

let estate: Pipeline[];
let analyses: PipelineAnalysis[];
beforeAll(async () => {
  const source = new FixtureSource(fixture);
  const bare = await loadEstate(source, new MemoryCache());
  estate = withFacts(bare, (await loadMetadata(source, new MemoryCache(), bare)).facts);
  analyses = estate.map((p) => pipelineState(p, options));
});

const label = (e: FolderEntry) =>
  e.kind === 'pipeline' ? e.analysis.pipeline.name : `${e.line.name} [${e.members.map((m) => m.pipeline.name).join(', ')}]`;
const entries = (query = '', filter: Parameters<typeof folderEntries>[2]['filter'] = null) =>
  folderEntries(analyses, inferLines(estate), { query, filter });

describe('folderEntries on the contoso estate', () => {
  it('puts each line in one entry, in its folder, worst state first', () => {
    const tools = entries().get('\\tools')!;
    expect(tools.map(label)).toContain('webapp-admin [webapp-admin-ci, webapp-admin-build, webapp-admin-deploy]');
    expect(tools.map(label)).not.toContain('webapp-admin-ci');
    const all = [...entries().values()].flat();
    expect(all.filter((e) => e.kind === 'line')).toHaveLength(6);
    // Every pipeline once, all 33.
    expect(all.reduce((n, e) => n + (e.kind === 'line' ? e.members.length : 1), 0)).toBe(33);
  });

  it("takes a line's state from its worst member and opens it then", () => {
    const etl = [...entries().values()].flat().find((e) => e.kind === 'line' && e.line.name === 'catalog-sync-etl');
    expect(etl).toMatchObject({ state: 'failing', autoOpen: true });
    if (etl?.kind !== 'line') throw new Error('no line');
    expect(etl.headline.pipeline.name).toBe('catalog-sync-etl-deploy');
    expect(isLineOpen({}, etl)).toBe(true);
    expect(isLineOpen({ 'catalog-sync-etl': false }, etl)).toBe(false);
  });

  it('shows the most downstream member when no member is worse', () => {
    const line = [...entries().values()].flat().find((e) => e.kind === 'line' && e.line.name === 'db-tool');
    if (line?.kind !== 'line') throw new Error('no line');
    expect(line.autoOpen).toBe(false);
    expect(line.headline.pipeline.name).toBe(line.members[line.members.length - 1]!.pipeline.name);
  });

  it('keeps a whole line, opened, when the filter matches one member', () => {
    const found = [...entries('storefront-deploy').values()].flat();
    expect(found.map(label)).toEqual([
      'webapp-storefront [webapp-storefront-ci, webapp-storefront-build, webapp-storefront-deploy]',
    ]);
    expect(found[0]).toMatchObject({ matched: true });
    expect(isLineOpen({}, found[0] as Extract<FolderEntry, { kind: 'line' }>)).toBe(true);
  });

  it('filters by state through any member', () => {
    const failing = [...entries('', 'failing').values()].flat().map(label);
    expect(failing).toEqual(['catalog-sync-etl [catalog-sync-etl-build, catalog-sync-etl-deploy]', 'model-retrain-run']);
  });

  it('shows plain rows until the metadata has loaded', () => {
    const bare = estate.map((p) => ({ ...p, facts: {} }));
    const map = folderEntries(analyses, inferLines(bare), { query: '', filter: null });
    expect([...map.values()].flat().every((e) => e.kind === 'pipeline')).toBe(true);
  });
});

describe('folderEntries with archived and disabled pipelines', () => {
  /** The capture with these pipelines archived in their metadata file. */
  const archive = (...names: string[]) => {
    const marked = estate.map((p) => (names.includes(p.name) ? { ...p, facts: { ...p.facts, archived: true } } : p));
    return folderEntries(
      marked.map((p) => pipelineState(p, options)),
      inferLines(marked),
      { query: '', filter: null },
    );
  };
  const flat = (map: Map<string, FolderEntry[]>) => [...map.values()].flat();

  it('lists them last in their folder', () => {
    const map = archive('vault-secret-scope-create');
    expect(map.get('\\tools')!.map(label).at(-1)).toBe('vault-secret-scope-create');
    // legacy-export-run is disabled in Azure DevOps.
    expect(map.get('\\archive')!.map(label)).toEqual(['legacy-export-build-deploy', 'reports-api-build', 'legacy-export-run']);
  });

  it('keeps a wholly archived line a line, quiet and closed', () => {
    const etl = flat(archive('catalog-sync-etl-build', 'catalog-sync-etl-deploy')).find((e) => e.kind === 'line' && e.line.name === 'catalog-sync-etl');
    expect(etl).toMatchObject({ retired: true, state: 'failing', autoOpen: false });
  });

  it("judges a partly archived line by its other members", () => {
    const etl = flat(archive('catalog-sync-etl-deploy')).find((e) => e.kind === 'line' && e.line.name === 'catalog-sync-etl');
    if (etl?.kind !== 'line') throw new Error('no line');
    expect(etl).toMatchObject({ retired: false, state: 'healthy', autoOpen: false });
    expect(etl.headline.pipeline.name).toBe('catalog-sync-etl-build');
  });

  it('leaves them out of a state filter, as Pipeline health leaves them out of its counts', () => {
    const marked = estate.map((p) => (p.name.startsWith('catalog-sync-etl') ? { ...p, facts: { ...p.facts, archived: true } } : p));
    const failing = folderEntries(marked.map((p) => pipelineState(p, options)), inferLines(marked), { query: '', filter: 'failing' });
    expect(flat(failing).map(label)).toEqual(['model-retrain-run']);
  });
});
