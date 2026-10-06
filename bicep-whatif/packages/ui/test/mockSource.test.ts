/**
 * `?mock=1`. Its job is to exercise the correctness rule every time someone
 * opens it offline, so the thing to pin is that both kinds of missing stage are
 * always in it.
 */
import { describe, expect, it } from 'vitest';
import { createMockSource } from '../src/data/mock.js';

describe('createMockSource', () => {
  it('is the mock source', () => {
    expect(createMockSource().kind).toBe('mock');
  });

  it('loads every committed what-if fixture as an evaluated stage', async () => {
    const { stages, notes } = await createMockSource().load();
    const network = stages.find((s) => s.stackId === 'app-network');
    expect(network).toMatchObject({
      stageId: 'WhatIf_AppNetwork',
      displayName: 'app-network',
      result: 'succeeded',
      sidecar: { stackId: 'app-network', status: 'succeeded' },
    });
    expect(network?.payload).toBeTypeOf('object');
    expect(stages.find((s) => s.stackId === 'synthetic-schema-drift')?.stageId).toBe('WhatIf_SyntheticSchemaDrift');
    expect(notes.join(' ')).toMatch(/Mock mode/);
    // The timeline capture beside them is not a what-if payload and must not become a stack.
    expect(stages.map((s) => s.stackId)).not.toContain('timeline-and-attachments');
  });

  it('always includes a stage that failed and attached nothing', async () => {
    const { stages } = await createMockSource().load();
    const failed = stages.find((s) => s.stageId === 'WhatIf_PlatformProd');
    expect(failed?.payload).toBeUndefined();
    expect(failed?.sidecar?.status).toBe('failed');
  });

  it('always includes a stage that left neither attachment nor sidecar', async () => {
    const { stages } = await createMockSource().load();
    const gone = stages.find((s) => s.stageId === 'WhatIf_WorkloadAlphaRegxProd');
    expect(gone).toBeDefined();
    expect(gone?.payload).toBeUndefined();
    expect(gone?.sidecar).toBeUndefined();
  });
});
