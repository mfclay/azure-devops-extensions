import type { Fixture, PipelineFacts, Run, Timeline } from '../../src/index.js';
import type { MockupData, MockupRun } from './mockup.js';

/**
 * Reshapes a fixture into the pipeline list the mockup reads, the way the mockup's data was
 * built (by the mockup's own snapshot script, outside this repo). It deliberately shares
 * no code with src/, so the golden tests check the port's own reshaping too.
 *
 * Trigger lines and owners come from the facts, in the catalog generator's wording: the mockup
 * reads "Manual only" and "After `X`" lines, and an owner of "" or "TODO" as none.
 */
export function toMockupData(fixture: Fixture, facts: Readonly<Record<number, PipelineFacts>>, now: string): MockupData {
  const byDefinition = new Map<number, Run[]>();
  for (const b of fixture.runs) byDefinition.set(b.definition.id, [...(byDefinition.get(b.definition.id) ?? []), b]);

  // Timelines for the newest run of each pipeline, plus every unfinished run.
  const want = new Set<number>();
  for (const bs of byDefinition.values()) if (bs[0]) want.add(bs[0].id);
  for (const b of fixture.runs) if (b.status !== 'completed') want.add(b.id);

  return {
    generated: now,
    pipelines: fixture.definitions.map((d) => {
      const f = facts[d.id] ?? {};
      // The mockup has no notion of unknown triggers. A YAML that could not be read leaves them
      // unknown, which the port treats as the mockup treats manual-only: never idle-with-triggers.
      const manualOnly = f.manualOnly || Boolean(f.yaml);
      const triggers = manualOnly ? ['Manual only'] : f.runsAfter ? [`After \`${f.runsAfter}\`: \`main\``] : [];
      return {
        id: d.id,
        name: d.name,
        folder: d.path || '\\',
        disabled: d.queueStatus === 'disabled',
        retired: d.queueStatus === 'disabled' || Boolean(f.archived),
        owner: f.owner ?? '',
        triggers,
        runs: (byDefinition.get(d.id) ?? []).map(
          (b): MockupRun => ({
            id: b.id,
            status: b.status,
            result: b.result ?? null,
            branch: (b.sourceBranch ?? '').startsWith('refs/heads/') ? (b.sourceBranch ?? '').slice(11) : (b.sourceBranch ?? ''),
            queued: b.queueTime,
            started: b.startTime ?? null,
            finished: b.finishTime ?? null,
            stages: want.has(b.id) ? stages(fixture.timelines[b.id]) : null,
          }),
        ),
      };
    }),
  };
}

/** snapshot.py's stages(): a missing timeline gives no stages, not null. */
function stages(t: Timeline | undefined): MockupRun['stages'] {
  if (!t) return [];
  const recs = t.records;
  return recs
    .filter((r) => r.type === 'Stage')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((r) => {
      const parents = new Set([...recs.filter((x) => x.parentId === r.id).map((x) => x.id), r.id]);
      const waiting = recs.some(
        (c) => c.type === 'Checkpoint.Approval' && c.state === 'inProgress' && parents.has(c.parentId as string),
      );
      return [r.name ?? '', r.state ?? null, r.result ?? null, waiting];
    });
}
