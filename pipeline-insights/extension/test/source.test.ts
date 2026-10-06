import { loadEstate, MemoryCache, type Fixture } from '@pipeline-insights/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests may import fixtures; only demo-source.ts may, under src/.
import fixtureJson from '../../core/fixtures/contoso.json';

vi.mock('azure-devops-extension-sdk', () => ({ getAccessToken: vi.fn(async () => 'hub-token') }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hubSource', () => {
  it('reads the project the hub is open in, with the token the SDK hands out', async () => {
    const requests: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify({ value: [] }), { headers: { 'content-type': 'application/json' } });
    });
    const { hubSource } = await import('../src/source.js');
    await hubSource('https://dev.azure.com/contoso/', 'Platform').definitions();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(/^https:\/\/dev\.azure\.com\/contoso\/Platform\/_apis\/build\/definitions\?/);
    expect(requests[0]?.auth).toBe('Bearer hub-token');
  });
});

describe('the demo hub source', () => {
  const fixture = fixtureJson as unknown as Fixture;

  it('serves the contoso estate whatever project it is open in, with its clock moved to now', async () => {
    const now = Date.parse('2027-03-01T09:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'], now });
    const { hubSource } = await import('../src/demo-source.js');
    const source = hubSource('https://dev.azure.com/fabrikam/', 'Elsewhere');

    const shift = now - Date.parse(fixture.capturedAt);
    const demo = await source.runs([101, 102, 103], 50);
    expect(demo.length).toBeGreaterThan(0);
    for (const run of demo) {
      const original = fixture.runs.find((r) => r.id === run.id)!;
      expect(Date.parse(run.queueTime)).toBe(Date.parse(original.queueTime) + shift);
      // Strings that are not timestamps stay as they were.
      expect(run.sourceBranch).toBe(original.sourceBranch);
    }
    expect((await source.definitions()).map((d) => d.name)).toEqual(fixture.definitions.map((d) => d.name));
  });

  it('reads as an estate captured just now', async () => {
    const now = Date.parse('2027-03-01T09:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'], now });
    const { hubSource } = await import('../src/demo-source.js');
    const estate = await loadEstate(hubSource('', ''), new MemoryCache());
    const latest = Math.max(...estate.flatMap((p) => p.runs.map((r) => Date.parse(r.queued))));
    expect(latest).toBeLessThanOrEqual(now);
    expect(now - latest).toBeLessThan(7 * 24 * 3600_000);
  });
});
