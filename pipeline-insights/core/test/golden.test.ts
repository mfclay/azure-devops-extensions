import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  describeLine,
  FixtureSource,
  inferLines,
  loadEstate,
  loadMetadata,
  MemoryCache,
  withFacts,
  type EstateMetadata,
  type Fixture,
  type Pipeline,
} from '../src/index.js';
import { fixtureText } from '../fixtures/contoso.js';
import { toMockupData } from './oracle/adapter.js';
import { mockupSummary, outcomes, portSummary, VIEWS, viewName, type Summary } from './oracle/compare.js';

/**
 * The ported rules against the mockup's own, on the synthetic contoso estate, in every view the
 * page offers. The mockup's results are also kept in a golden file beside the fixture, so a change
 * to the estate shows its differences for a human to check: `npx vitest run -u` rewrites it. So
 * are the facts `loadMetadata()` reads from the fixture's files, which both sides take as input.
 */
const NAME = 'contoso';
const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')) as T;

const fixture = read<Fixture>(`${NAME}.json`);
const now = Date.parse(fixture.capturedAt);

let estate: Pipeline[];
let metadata: EstateMetadata;
let data: ReturnType<typeof toMockupData>;
beforeAll(async () => {
  const source = new FixtureSource(fixture);
  const bare = await loadEstate(source, new MemoryCache());
  metadata = await loadMetadata(source, new MemoryCache(), bare);
  estate = withFacts(bare, metadata.facts);
  data = toMockupData(fixture, metadata.facts, fixture.capturedAt);
});

describe(`golden: ${NAME}`, () => {
  it('is what fixtures/contoso.ts builds', () => {
    // Edit contoso.ts and run `npm run fixture`; never edit the JSON by hand.
    expect(readFileSync(new URL(`../fixtures/${NAME}.json`, import.meta.url), 'utf8')).toBe(fixtureText());
  });

  it.each(VIEWS.map((v) => [viewName(v), v] as const))('%s: the port matches the mockup', (_, view) => {
    expect(portSummary(estate, view, now)).toEqual(mockupSummary(data, view));
  });

  it("classifies every run as the mockup's history strip does", () => {
    const { port, mockup } = outcomes(estate, data);
    expect(port).toEqual(mockup);
  });

  it("matches the mockup's recorded results", async () => {
    const golden: Record<string, Summary> = {};
    for (const view of VIEWS) golden[viewName(view)] = mockupSummary(data, view);
    await expect(lineJson(golden)).toMatchFileSnapshot(`../fixtures/${NAME}.golden.json`);
  });

  it('reads the facts recorded for this fixture', async () => {
    const byName = Object.fromEntries(fixture.definitions.map((d) => [d.name, metadata.facts[d.id]]));
    await expect(lineJson({ facts: byName, catalogs: metadata.catalogs })).toMatchFileSnapshot(`../fixtures/${NAME}.facts.golden.json`);
  });

  it('infers the lines and suggestions in the design table', async () => {
    const { lines, suggestions } = inferLines(estate);
    const name = (id: number) => estate.find((p) => p.id === id)!.name;
    const golden = {
      lines: Object.fromEntries(
        lines.map((l) => [l.name, { pipelines: describeLine(l, estate), folder: l.folder, formedBy: l.formedBy }]),
      ),
      suggestions: suggestions.map((s) => ({ pipelines: s.pipelines.map(name), signal: s.signal, ...(s.folder && { folder: s.folder }) })),
    };
    expect([lines.length, suggestions.length]).toEqual([6, 5]);
    await expect(lineJson(golden)).toMatchFileSnapshot(`../fixtures/${NAME}.lines.golden.json`);
  });

  it('reads every drafted entry cleanly', () => {
    const entries = Object.values(metadata.facts).filter((f) => f.purposeSource === 'catalog');
    expect(entries).toHaveLength(29);
    expect(entries.filter((f) => f.metadataProblems)).toEqual([]);
    expect(metadata.catalogs.filter((c) => c.problems.length || c.orphans.length)).toEqual([]);
    // Every drafted purpose is still marked (TODO: verify), as the drafts were written.
    expect(entries.every((f) => f.purpose && f.draft)).toBe(true);
  });
});

/** JSON with one line per pipeline or item, so a change to the estate diffs line by line. */
function lineJson(value: unknown, depth = 0): string {
  if (depth === 3 || value === null || typeof value !== 'object' || !Object.keys(value).length) return JSON.stringify(value);
  const pad = ' '.repeat(depth + 1);
  const entries = Array.isArray(value)
    ? value.map((v) => pad + lineJson(v, depth + 1))
    : Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${lineJson(v, depth + 1)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${entries.join(',\n')}\n${' '.repeat(depth)}${close}${depth ? '' : '\n'}`;
}
