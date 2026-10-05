import { describe, expect, it } from 'vitest';
import {
  isWhatIfStage,
  joinStages,
  parseAttachmentHref,
  stageIdFromStackId,
  stageRecordFor,
  type TimelineRecordLike,
} from '../src/data/join.js';

const HREF =
  'https://dev.azure.com/contoso/Platform/_apis/build/builds/7700017/' +
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb/' +
  'attachments/whatif.stack.json/shared-infra';

/** A stage → job → task chain, the shape a real timeline has. */
function chain(stageIdentifier: string, ids: [string, string, string]): TimelineRecordLike[] {
  const [stage, job, task] = ids;
  return [
    { id: stage, type: 'Stage', identifier: stageIdentifier, name: `Display ${stageIdentifier}`, result: 'succeeded' },
    { id: job, type: 'Job', parentId: stage, name: 'WhatIf' },
    { id: task, type: 'Task', parentId: job, name: 'What-If' },
  ];
}

describe('parseAttachmentHref', () => {
  it('pulls timeline and record ids out of a self link', () => {
    expect(parseAttachmentHref(HREF)).toEqual({
      timelineId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      recordId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      type: 'whatif.stack.json',
      name: 'shared-infra',
    });
  });

  it('returns undefined rather than throwing on anything unexpected', () => {
    expect(parseAttachmentHref(undefined)).toBeUndefined();
    expect(parseAttachmentHref('')).toBeUndefined();
    expect(parseAttachmentHref('https://example.invalid/nope')).toBeUndefined();
  });
});

describe('stageRecordFor', () => {
  it('walks a task record up to its enclosing stage', () => {
    const records = chain('WhatIf_SharedInfra', ['s1', 'j1', 't1']);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(stageRecordFor('t1', byId)?.identifier).toBe('WhatIf_SharedInfra');
  });

  it('does not loop forever on a cyclic parent chain', () => {
    const byId = new Map<string, TimelineRecordLike>([
      ['a', { id: 'a', parentId: 'b', type: 'Task' }],
      ['b', { id: 'b', parentId: 'a', type: 'Task' }],
    ]);
    expect(stageRecordFor('a', byId)).toBeUndefined();
  });
});

describe('isWhatIfStage', () => {
  it('matches only WhatIf_* stage records', () => {
    expect(isWhatIfStage({ id: '1', type: 'Stage', identifier: 'WhatIf_Network' })).toBe(true);
    expect(isWhatIfStage({ id: '2', type: 'Stage', identifier: 'Deploy_Network' })).toBe(false);
    expect(isWhatIfStage({ id: '3', type: 'Job', identifier: 'WhatIf_Network' })).toBe(false);
  });
});

describe('stageIdFromStackId', () => {
  it('re-Pascal-cases a stack id the way the pipelines name their stages', () => {
    expect(stageIdFromStackId('network')).toBe('WhatIf_Network');
    expect(stageIdFromStackId('shared-infra')).toBe('WhatIf_SharedInfra');
    expect(stageIdFromStackId('workload-alpha-regx-dev')).toBe('WhatIf_WorkloadAlphaRegxDev');
  });
});

describe('joinStages', () => {
  it('joins an attachment onto the stage that emitted it', () => {
    const records = chain('WhatIf_SharedInfra', ['s1', 'j1', 't1']);
    const stages = joinStages({
      records,
      payloads: [
        {
          ref: { timelineId: 'tl', recordId: 't1', type: 'whatif.stack.json', name: 'shared-infra' },
          payload: { hello: true },
        },
      ],
      sidecars: [],
    });

    expect(stages).toHaveLength(1);
    expect(stages[0]?.stageId).toBe('WhatIf_SharedInfra');
    expect(stages[0]?.stackId).toBe('shared-infra');
    expect(stages[0]?.payload).toEqual({ hello: true });
  });

  // The correctness rule, at the join layer.
  it('keeps a stage that produced no attachment, with no payload', () => {
    const records = [
      ...chain('WhatIf_Network', ['s1', 'j1', 't1']),
      ...chain('WhatIf_PlatformProd', ['s2', 'j2', 't2']),
    ];
    const stages = joinStages({
      records,
      payloads: [
        {
          ref: { timelineId: 'tl', recordId: 't1', type: 'whatif.stack.json', name: 'network' },
          payload: { ok: 1 },
        },
      ],
      sidecars: [],
    });

    expect(stages.map((s) => s.stageId)).toEqual(['WhatIf_Network', 'WhatIf_PlatformProd']);
    const missing = stages.find((s) => s.stageId === 'WhatIf_PlatformProd');
    expect(missing).toBeDefined();
    expect(missing?.payload).toBeUndefined();
  });

  it('takes the stack id off the sidecar when only the sidecar attached', () => {
    const records = chain('WhatIf_PlatformProd', ['s1', 'j1', 't1']);
    const stages = joinStages({
      records,
      payloads: [],
      sidecars: [
        {
          ref: { timelineId: 'tl', recordId: 't1', type: 'whatif.stack.sidecar', name: 'platform-prod' },
          sidecar: { stackId: 'platform-prod', status: 'failed', error: 'boom' },
        },
      ],
    });

    expect(stages[0]?.stackId).toBe('platform-prod');
    expect(stages[0]?.payload).toBeUndefined();
    expect(stages[0]?.sidecar?.status).toBe('failed');
  });

  it('falls back to the naming rule when the record is not in the timeline, and says so', () => {
    const records = chain('WhatIf_SharedInfra', ['s1', 'j1', 't1']);
    const stages = joinStages({
      records,
      payloads: [
        {
          // A record id that is nowhere in the timeline.
          ref: { timelineId: 'tl', recordId: 'unknown', type: 'whatif.stack.json', name: 'shared-infra' },
          payload: { ok: 1 },
        },
      ],
      sidecars: [],
    });

    expect(stages).toHaveLength(1);
    expect(stages[0]?.payload).toEqual({ ok: 1 });
    expect(stages[0]?.notes.join(' ')).toMatch(/naming rule/);
  });

  it('never drops an attachment whose stage is missing from the timeline entirely', () => {
    const stages = joinStages({
      records: [],
      payloads: [
        {
          ref: { timelineId: 'tl', recordId: 'x', type: 'whatif.stack.json', name: 'orphan-stack' },
          payload: { ok: 1 },
        },
      ],
      sidecars: [],
    });

    expect(stages).toHaveLength(1);
    expect(stages[0]?.stackId).toBe('orphan-stack');
    expect(stages[0]?.notes.join(' ')).toMatch(/No timeline stage matched/);
  });
});
