/**
 * Replay a real build through the pure join.
 *
 * `join.test.ts` proves the join against hand-built timelines, which is the right
 * way to cover the awkward cases — a cyclic parent chain, a missing stage — but
 * it cannot prove the *premises*. Every shape it asserts on was written by the
 * same person who wrote the code under test, so the two agree by construction.
 *
 * This file is the counterweight. The fixture is a capture of Azure DevOps build
 * 7700078 and nothing in it was authored here: the timeline records, the two
 * attachment lists and the nine sidecars came back from the REST API, and only
 * the identifiers were substituted. If the real `_links.self.href` format, the
 * real `Stage` record type, or the real parent chain were not what `join.ts`
 * assumes, these assertions are what notice.
 *
 * The build is a useful one to have caught: nine what-if stages across all five
 * layers, alongside nine `Deploy_*` stages, a `DetectChanges` stage and a
 * `WhatIfRollup` stage that the prefix test has to reject.
 */
import { describe, expect, it } from 'vitest';
import {
  attachmentRefs,
  isWhatIfStage,
  joinStages,
  type AttachmentLike,
  type TimelineRecordLike,
} from '../src/data/join.js';
import type { Sidecar } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

interface Capture {
  timelineId: string;
  records: TimelineRecordLike[];
  attachments: Record<string, AttachmentLike[]>;
  sidecars: Record<string, Sidecar>;
}

const capture = fixture('real/build-7700078-timeline-and-attachments.json') as Capture;

const PAYLOAD = 'whatif.stack.json';
const SIDECAR = 'whatif.stack.sidecar';

/** The nine stacks the captured build evaluated, by attachment name. */
const STACKS = [
  'client-alpha',
  'network',
  'platform-dev',
  'platform-prod',
  'shared-infra',
  'workload-alpha-regx-dev',
  'workload-alpha-regx-prod',
  'workload-alpha-regy-dev',
  'workload-alpha-regy-prod',
];

/**
 * Rebuild the join input the way `createAdoSource` does, minus the network. The
 * payload bodies are stood in for — the join treats a payload as opaque and only
 * ever carries it — but every id, href and sidecar is the captured one.
 */
function replay() {
  const payload = attachmentRefs(capture.attachments[PAYLOAD] ?? [], 'what-if');
  const sidecar = attachmentRefs(capture.attachments[SIDECAR] ?? [], 'sidecar');
  return {
    payload,
    sidecar,
    stages: joinStages({
      records: capture.records,
      payloads: payload.refs.map((ref) => ({ ref, payload: { _stub: ref.name } })),
      sidecars: sidecar.refs.map((ref) => ({ ref, sidecar: capture.sidecars[ref.name] as Sidecar })),
    }),
  };
}

describe('the captured build', () => {
  it('is the shape the capture claims — a real multi-stack run', () => {
    expect(capture.records).toHaveLength(145);
    expect(capture.attachments[PAYLOAD]).toHaveLength(9);
    expect(capture.attachments[SIDECAR]).toHaveLength(9);
    expect(Object.keys(capture.sidecars).sort()).toEqual(STACKS);
  });
});

describe('attachmentRefs, against real attachment lists', () => {
  it('parses every real self link, with nothing skipped', () => {
    const { payload, sidecar } = replay();
    expect(payload.notes).toEqual([]);
    expect(sidecar.notes).toEqual([]);
    expect(payload.refs).toHaveLength(9);
    expect(sidecar.refs).toHaveLength(9);
  });

  it('reads the type and name back out of the href, not out of the list entry', () => {
    const { payload, sidecar } = replay();
    // `name` is the only field the list carries, so agreement between it and the
    // href is a real check: it is what lets the join key on the stack id.
    expect(payload.refs.map((r) => r.name).sort()).toEqual(STACKS);
    expect(new Set(payload.refs.map((r) => r.type))).toEqual(new Set([PAYLOAD]));
    expect(new Set(sidecar.refs.map((r) => r.type))).toEqual(new Set([SIDECAR]));
  });

  it('finds the same timeline id in every href as the timeline resource reports', () => {
    const { payload, sidecar } = replay();
    for (const ref of [...payload.refs, ...sidecar.refs]) {
      expect(ref.timelineId).toBe(capture.timelineId);
    }
  });

  it('points every ref at a record that is actually in the timeline', () => {
    const { payload, sidecar } = replay();
    const ids = new Set(capture.records.map((r) => r.id));
    for (const ref of [...payload.refs, ...sidecar.refs]) {
      expect(ids.has(ref.recordId)).toBe(true);
    }
  });
});

describe('isWhatIfStage, against a real timeline', () => {
  it('selects the nine what-if stages and nothing else', () => {
    const stages = capture.records.filter(isWhatIfStage);
    expect(stages).toHaveLength(9);
    expect(stages.every((s) => s.type === 'Stage')).toBe(true);
  });

  it('rejects WhatIfRollup, which is one character from matching', () => {
    // The prefix is `whatif_`; this stage is `WhatIfRollup`. A prefix test written
    // as `whatif` rather than `whatif_` would swallow it, and the roll-up stage
    // attaches nothing — so it would surface as a permanently unevaluated stack.
    const rollup = capture.records.find((r) => r.identifier === 'WhatIfRollup');
    expect(rollup).toBeDefined();
    expect(isWhatIfStage(rollup as TimelineRecordLike)).toBe(false);
  });

  it('rejects the Deploy_* stages the same run contains', () => {
    const deploys = capture.records.filter(
      (r) => r.type === 'Stage' && r.identifier?.startsWith('Deploy_'),
    );
    expect(deploys).toHaveLength(9);
    expect(deploys.some(isWhatIfStage)).toBe(false);
  });

  it('rejects the Phase and Job records that also carry a WhatIf_* identifier', () => {
    // The discovery this capture paid for. A real timeline gives the phase and the
    // job beneath each stage an identifier derived from it —
    // `WhatIf_ClientAlpha.WhatIf` and `WhatIf_ClientAlpha.WhatIf.__default` — so 27
    // records match the `whatif_` prefix and only 9 of them are stages. The
    // `type === 'Stage'` guard is therefore load-bearing, not defensive: without
    // it every stack would be counted three times. No hand-built timeline in
    // `join.test.ts` has a Phase in it at all, so nothing there could have caught
    // this.
    const prefixed = capture.records.filter((r) => r.identifier?.toLowerCase().startsWith('whatif_'));
    expect(prefixed).toHaveLength(27);
    expect(prefixed.filter(isWhatIfStage)).toHaveLength(9);
    expect(prefixed.filter((r) => r.type !== 'Stage')).toHaveLength(18);
  });
});

describe('joinStages, against a real timeline', () => {
  it('returns one row per what-if stage, each carrying its payload and sidecar', () => {
    const { stages } = replay();
    expect(stages).toHaveLength(9);
    expect(stages.every((s) => s.payload !== undefined)).toBe(true);
    expect(stages.every((s) => s.sidecar !== undefined)).toBe(true);
    expect(stages.map((s) => s.stackId).sort()).toEqual(STACKS);
  });

  it('joins structurally, never falling back to the stage-id naming rule', () => {
    // The fallback exists, and firing it here would mean the parent-chain walk
    // failed against a real timeline while the tests still passed on the guess.
    const { stages } = replay();
    expect(stages.flatMap((s) => s.notes)).toEqual([]);
  });

  it('walks Task -> Job -> Phase -> Stage, which is deeper than a hand-built chain', () => {
    // `join.test.ts` builds Stage -> Job -> Task. Real timelines interpose a
    // Phase, so the loop has to survive an arbitrary depth rather than exactly one
    // hop. This asserts the real depth is what the capture contains.
    const byId = new Map(capture.records.map((r) => [r.id, r]));
    const { payload } = replay();
    const depths = payload.refs.map((ref) => {
      const chain: string[] = [];
      let cur = byId.get(ref.recordId);
      while (cur && cur.type !== 'Stage') {
        chain.push(cur.type ?? '?');
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return chain.join('>');
    });
    expect(new Set(depths)).toEqual(new Set(['Task>Job>Phase']));
  });

  it('pairs each stage with the stack its own sidecar names', () => {
    const { stages } = replay();
    for (const s of stages) {
      expect(s.sidecar?.stackId).toBe(s.stackId);
    }
  });

  it('takes the display name off the timeline and the stage id off the identifier', () => {
    const { stages } = replay();
    const network = stages.find((s) => s.stackId === 'network');
    expect(network?.stageId).toBe('WhatIf_Network');
    expect(network?.displayName).toBe('Stack 1 — Network');
    expect(network?.result).toBe('succeeded');
    expect(network?.state).toBe('completed');
    // The stage's own timeline record, which its log link is made from.
    expect(network?.recordId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('covers all five layers, which no previous fixture did', () => {
    const { stages } = replay();
    const layers = stages.map((s) => s.sidecar?.layer).sort();
    expect(layers).toEqual([1, 2, 3, 3, 4, 5, 5, 5, 5]);
  });

  it('keeps a what-if stage that attached nothing, ranked as unevaluated', () => {
    // The correctness rule, exercised against real records rather than invented
    // ones: drop one stack's attachments and its stage must survive the join with
    // no payload, not vanish from the estate.
    const payload = attachmentRefs(capture.attachments[PAYLOAD] ?? [], 'what-if');
    const sidecar = attachmentRefs(capture.attachments[SIDECAR] ?? [], 'sidecar');
    const stages = joinStages({
      records: capture.records,
      payloads: payload.refs
        .filter((r) => r.name !== 'network')
        .map((ref) => ({ ref, payload: { _stub: ref.name } })),
      sidecars: sidecar.refs
        .filter((r) => r.name !== 'network')
        .map((ref) => ({ ref, sidecar: capture.sidecars[ref.name] as Sidecar })),
    });

    expect(stages).toHaveLength(9);
    const network = stages.find((s) => s.stageId === 'WhatIf_Network');
    expect(network).toBeDefined();
    expect(network?.payload).toBeUndefined();
    expect(network?.sidecar).toBeUndefined();
  });
});
