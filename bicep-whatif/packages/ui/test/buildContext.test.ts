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

import {
  buildResultsUrl,
  describeConfig,
  LOCATION_SERVICE_ID,
  PROJECT_PAGE_SERVICE_ID,
  resolveBuildContext,
  resolveBuildResultsUrl,
} from '../src/data/buildContext.js';

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

describe('resolveBuildResultsUrl', () => {
  const services = (location: unknown, page: unknown) => (id: string) =>
    Promise.resolve(id === LOCATION_SERVICE_ID ? location : id === PROJECT_PAGE_SERVICE_ID ? page : undefined);

  it('names the project when the host says its name', async () => {
    const url = await resolveBuildResultsUrl(
      'p-id',
      21,
      services(
        { getServiceLocation: () => Promise.resolve('https://dev.azure.com/contoso/') },
        { getProject: () => Promise.resolve({ id: 'p-id', name: 'Platform Team' }) },
      ),
    );
    expect(url).toBe('https://dev.azure.com/contoso/Platform%20Team/_build/results?buildId=21');
  });

  it('falls back to the project id, and adds the slash a root URL lacks', async () => {
    const url = await resolveBuildResultsUrl(
      'p-id',
      21,
      services({ getServiceLocation: () => Promise.resolve('https://dev.azure.com/contoso') }, undefined),
    );
    expect(url).toBe('https://dev.azure.com/contoso/p-id/_build/results?buildId=21');
  });

  it('gives up quietly when the host gives no URL, so the tab just draws no link', async () => {
    expect(await resolveBuildResultsUrl('p-id', 21, services(undefined, undefined))).toBeUndefined();
    const throwing = (): Promise<unknown> => Promise.reject(new Error('no such service'));
    expect(await resolveBuildResultsUrl('p-id', 21, throwing)).toBeUndefined();
  });

  it('builds the same URL directly', () => {
    expect(buildResultsUrl('https://dev.azure.com/contoso/', 'Platform', 7)).toBe(
      'https://dev.azure.com/contoso/Platform/_build/results?buildId=7',
    );
  });
});
