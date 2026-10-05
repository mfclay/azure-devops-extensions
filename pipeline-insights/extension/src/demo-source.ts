import { FixtureSource, type Fixture, type PipelineSource } from '@pipeline-insights/core';
// The synthetic estate. Reached only by a `--mode demo` build, which swaps this module in for
// `source.ts`; the dev and release hubs never import it, and their identifier check would fail
// if they did.
import contoso from '../../core/fixtures/contoso.json';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Every timestamp in the fixture, moved by `ms`, so the estate reads as captured just now. */
function shifted<T>(value: T, ms: number): T {
  if (typeof value === 'string') return (ISO.test(value) ? new Date(Date.parse(value) + ms).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => shifted(v, ms)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shifted(v, ms)])) as T;
  }
  return value;
}

/** The demo hub's source: the contoso estate, whatever project the hub is open in. */
export function hubSource(_collection: string, _project: string): PipelineSource {
  const fixture = contoso as unknown as Fixture;
  return new FixtureSource(shifted(fixture, Date.now() - Date.parse(fixture.capturedAt)));
}
