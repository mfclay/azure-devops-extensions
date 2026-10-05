/**
 * The host handshake, and the ordering rule it imposes.
 *
 * This is the test that was missing when the tab shipped: 73 passing tests and
 * a green build, and the first run in a real organisation deadlocked before it
 * rendered a single row. Nothing here talks to Azure DevOps — the point is that
 * nothing needs to. The bug was an *ordering* bug, and ordering is testable
 * against a stub.
 *
 * What made it expensive is that `getService` before `init()` does not throw in
 * a real host; it never settles. So the `try`/`catch` that looks like it covers
 * the case does not, and the failure surfaces as "taking longer than expected
 * to load" — a message about time, pointing nowhere near the cause.
 *
 * The stub below is therefore *stricter than the host*: it throws where the
 * host would hang. A hang cannot be asserted on without racing a timeout, and a
 * throw fails the test in the same situation the host would stall in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  initialised: false,
}));

vi.mock('azure-devops-extension-sdk', () => ({
  init: async (): Promise<void> => {
    h.calls.push('init');
    h.initialised = true;
  },
  ready: async (): Promise<void> => {
    h.calls.push('ready');
  },
  getService: async (): Promise<unknown> => {
    h.calls.push('getService');
    if (!h.initialised) {
      throw new Error('getService before init — in a real host this hangs forever');
    }
    return {
      getHash: async () => '#',
      setHash: () => undefined,
      onHashChanged: () => undefined,
    };
  },
  notifyLoadSucceeded: (): void => {
    h.calls.push('notifyLoadSucceeded');
  },
}));

const { ensureSdkReady, resetSdkForTests } = await import('../src/data/sdk.js');
const { createHostNavigation } = await import('../src/nav/navigation.js');

beforeEach(() => {
  h.calls.length = 0;
  h.initialised = false;
  resetSdkForTests();
});

describe('the SDK handshake', () => {
  it('initialises before it declares itself ready', async () => {
    await ensureSdkReady();
    expect(h.calls).toEqual(['init', 'ready']);
  });

  it('happens exactly once however many callers ask for it', async () => {
    await Promise.all([ensureSdkReady(), ensureSdkReady(), ensureSdkReady()]);
    // A second init() would re-assert `loaded: false` after the host had already
    // been told the tab was ready, and the host would go back to waiting.
    expect(h.calls.filter((c) => c === 'init')).toHaveLength(1);
  });
});

describe('host navigation', () => {
  it('does not reach getService before init', async () => {
    await createHostNavigation();
    // Assert init happened *before* comparing positions. Without this line the
    // comparison passes vacuously on the broken code: init never runs, indexOf
    // returns -1, and -1 is duly less than every real index. Found by putting
    // the bug back and watching this test still pass.
    expect(h.calls).toContain('init');
    expect(h.calls.indexOf('init')).toBeLessThan(h.calls.indexOf('getService'));
  });

  it('returns the host-backed navigation rather than falling back', async () => {
    const nav = await createHostNavigation();
    // The regression this guards: calling getService first threw (hung, in the
    // host), and the catch quietly downgraded to window navigation — or, in the
    // host, never returned at all.
    expect(await nav.getHash()).toBe('');
    expect(h.calls).toContain('getService');
  });
});
