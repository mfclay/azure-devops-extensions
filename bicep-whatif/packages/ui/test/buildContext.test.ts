/**
 * How the tab finds the build it is attached to.
 *
 * The original code read `config.build`, which the live host does not supply.
 * The tab rendered "could not read the build it is attached to" on a page that
 * was self-evidently a build, and finding out why cost a publish-and-install
 * cycle. These tests exist so it costs nothing next time.
 *
 * Nothing here needs a host. The contract is "a callback delivers the build",
 * and a callback is trivially stubbed — the reason this was not caught earlier
 * is that no test tried, not that it was untestable.
 */
import { describe, expect, it, vi } from 'vitest';

import { describeConfig, resolveBuildContext } from '../src/data/buildContext.js';

const noService = async (): Promise<unknown> => undefined;

describe('resolveBuildContext', () => {
  it('reads a host that supplies the build directly', async () => {
    const ctx = await resolveBuildContext(
      { build: { id: 21, buildNumber: '20260826.3', project: { id: 'proj-1' } } },
      noService,
    );
    expect(ctx).toEqual({ projectId: 'proj-1', buildId: 21, buildNumber: '20260826.3' });
  });

  it('waits for onBuildChanged when there is no static build', async () => {
    const config = {
      onBuildChanged: (cb: (b: unknown) => void) => {
        cb({ id: 21, buildNumber: '20260826.3', project: { id: 'proj-1' } });
      },
    };
    expect(await resolveBuildContext(config, noService)).toEqual({
      projectId: 'proj-1',
      buildId: 21,
      buildNumber: '20260826.3',
    });
  });

  it('asks the host for the project when the build does not carry one', async () => {
    const config = {
      onBuildChanged: (cb: (b: unknown) => void) => {
        cb({ id: 21 });
      },
    };
    const getService = async (): Promise<unknown> => ({
      getProject: async () => ({ id: 'proj-from-service' }),
    });
    expect(await resolveBuildContext(config, getService)).toEqual({
      projectId: 'proj-from-service',
      buildId: 21,
    });
  });

  it('takes the first build when the host reports several', async () => {
    // A running build is handed over again as it changes. The first carries the
    // ids, which is all this tab needs — and resolving twice would reject.
    const config = {
      onBuildChanged: (cb: (b: unknown) => void) => {
        cb({ id: 21, project: { id: 'proj-1' } });
        cb({ id: 22, project: { id: 'proj-2' } });
      },
    };
    expect(await resolveBuildContext(config, noService)).toMatchObject({ buildId: 21 });
  });

  it('gives up rather than hanging when the host never calls back', async () => {
    vi.useFakeTimers();
    try {
      const config = { onBuildChanged: () => undefined };
      const pending = resolveBuildContext(config, noService);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns undefined when the host offers nothing usable', async () => {
    expect(await resolveBuildContext({}, noService)).toBeUndefined();
  });
});

describe('describeConfig', () => {
  it('lists what the host supplied, so the next failure is a glance', () => {
    expect(describeConfig({ onBuildChanged: () => undefined, zzz: 1, aaa: 2 })).toBe(
      'The host supplied: aaa, onBuildChanged, zzz.',
    );
  });

  it('says so when the configuration is empty', () => {
    expect(describeConfig({})).toBe('The host supplied an empty configuration.');
  });
});
