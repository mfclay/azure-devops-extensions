/**
 * The live source, against a stubbed host and a stubbed build client.
 *
 * `join.ts` is proven against the real build 7700078 capture already; this file
 * proves the fetching around it. The client below serves that same capture —
 * its timeline, its attachment lists, its sidecars — so every href, record id
 * and stack name `createAdoSource` sees is one Azure DevOps really returned.
 *
 * What it still cannot prove is the real host's handshake and the real
 * `BuildRestClient`'s wire behaviour. Those remain the installed build's job.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentLike, TimelineRecordLike } from '../src/data/join.js';
import { ATTACHMENT_TYPE_PAYLOAD, ATTACHMENT_TYPE_SIDECAR } from '../src/data/source.js';
import type { Sidecar } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

interface Capture {
  timelineId: string;
  records: TimelineRecordLike[];
  attachments: Record<string, AttachmentLike[]>;
  sidecars: Record<string, Sidecar>;
}

const capture = fixture('real/build-7700078-timeline-and-attachments.json') as Capture;
const NETWORK_PAYLOAD = fixture('real/build-7700017-app-network.json');

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  client: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
  getClientArg: undefined as unknown,
}));

vi.mock('azure-devops-extension-sdk', () => ({
  init: async (): Promise<void> => undefined,
  ready: async (): Promise<void> => undefined,
  getConfiguration: (): Record<string, unknown> => h.config,
  getService: async (): Promise<unknown> => undefined,
}));

vi.mock('azure-devops-extension-api', () => ({
  getClient: (ctor: unknown) => {
    h.getClientArg = ctor;
    return h.client;
  },
}));

vi.mock('azure-devops-extension-api/Build', () => ({
  BuildRestClient: class BuildRestClient {},
}));

const { createAdoSource } = await import('../src/data/ado.js');
const { resetSdkForTests } = await import('../src/data/sdk.js');

function encode(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** The capture, served the way `BuildRestClient` would serve it. */
function captureClient(over: Partial<typeof h.client> = {}): typeof h.client {
  return {
    getBuildTimeline: async () => ({ records: capture.records }),
    getAttachments: async (_project, _build, type) => capture.attachments[type as string] ?? [],
    getAttachment: async (_project, _build, _timeline, _record, type, name) =>
      encode(type === ATTACHMENT_TYPE_SIDECAR ? capture.sidecars[name as string] : NETWORK_PAYLOAD),
    ...over,
  };
}

beforeEach(() => {
  resetSdkForTests();
  h.config = { build: { id: 7700078, buildNumber: '20260826.3', project: { id: 'project-1' } } };
  h.client = captureClient();
  h.getClientArg = undefined;
});

describe('createAdoSource', () => {
  it('is the ado source', () => {
    expect(createAdoSource().kind).toBe('ado');
  });

  it('loads every what-if stage in the captured build, payload and sidecar attached', async () => {
    const result = await createAdoSource().load();
    expect(result.buildLabel).toBe('build 20260826.3');
    expect(result.notes).toEqual([]);
    expect(result.stages).toHaveLength(9);
    for (const stage of result.stages) {
      expect(stage.payload).toEqual(NETWORK_PAYLOAD);
      expect(stage.sidecar?.stackId).toBe(stage.stackId);
    }
    expect((h.getClientArg as { name?: string }).name).toBe('BuildRestClient');
  });

  it('asks for both attachment types against the right build', async () => {
    const getAttachments = vi.fn(captureClient().getAttachments);
    h.client = captureClient({ getAttachments });
    await createAdoSource().load();
    expect(getAttachments.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['project-1', 7700078, ATTACHMENT_TYPE_PAYLOAD],
      ['project-1', 7700078, ATTACHMENT_TYPE_SIDECAR],
    ]);
  });

  it('falls back to the build id when there is no build number', async () => {
    h.config = { build: { id: 21, project: { id: 'project-1' } } };
    expect((await createAdoSource().load()).buildLabel).toBe('build 21');
  });

  it('refuses, and says why, when it cannot find the build', async () => {
    h.config = { somethingElse: true };
    await expect(createAdoSource().load()).rejects.toThrow(/could not read the build it is attached to/);
  });

  it('carries on without sidecars when that list cannot be read', async () => {
    h.client = captureClient({
      getAttachments: async (_p, _b, type) => {
        if (type === ATTACHMENT_TYPE_SIDECAR) throw new Error('403');
        return capture.attachments[type as string] ?? [];
      },
    });
    const result = await createAdoSource().load();
    expect(result.stages).toHaveLength(9);
    expect(result.stages.every((s) => s.payload !== undefined)).toBe(true);
    expect(result.stages.every((s) => s.sidecar === undefined)).toBe(true);
  });

  it('fails the load when the payload list cannot be read', async () => {
    // Unlike the sidecar list, there is nothing to show without this one.
    h.client = captureClient({
      getAttachments: async () => {
        throw new Error('500');
      },
    });
    await expect(createAdoSource().load()).rejects.toThrow('500');
  });

  it('renders a stage whose attachment cannot be read as unevaluated, and says so', async () => {
    h.client = captureClient({
      getAttachment: async (_p, _b, _t, _r, type, name) => {
        if (type === ATTACHMENT_TYPE_PAYLOAD && name === 'network') throw new Error('gone');
        return captureClient().getAttachment?.(_p, _b, _t, _r, type, name);
      },
    });
    const result = await createAdoSource().load();
    const network = result.stages.find((s) => s.stackId === 'network');
    expect(network).toBeDefined();
    expect(network?.payload).toBeUndefined();
    expect(result.notes).toEqual([
      `Attachment "network" (${ATTACHMENT_TYPE_PAYLOAD}) could not be read: Error: gone`,
    ]);
    expect(result.stages.filter((s) => s.payload !== undefined)).toHaveLength(8);
  });

  it('notes a build with no what-if stages at all', async () => {
    h.client = captureClient({
      getBuildTimeline: async () => ({}),
      getAttachments: async () => [],
    });
    const result = await createAdoSource().load();
    expect(result.stages).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/No WhatIf_\* stages were found/);
  });
});
