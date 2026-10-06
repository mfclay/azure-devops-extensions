/**
 * @vitest-environment jsdom
 *
 * Deep links. `sdkHandshake.test.ts` covers the ordering rule; this covers what
 * the two navigations actually do, and that a host which offers no usable
 * service — or throws — still leaves a working tab on `window`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  service: undefined as unknown,
  throws: false,
}));

vi.mock('azure-devops-extension-sdk', () => ({
  init: async (): Promise<void> => undefined,
  ready: async (): Promise<void> => undefined,
  getService: async (): Promise<unknown> => {
    if (h.throws) throw new Error('no host');
    return h.service;
  },
}));

const { createHostNavigation, createWindowNavigation } = await import('../src/nav/navigation.js');
const { resetSdkForTests } = await import('../src/data/sdk.js');

beforeEach(() => {
  resetSdkForTests();
  h.service = undefined;
  h.throws = false;
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('window navigation', () => {
  it('reads the hash without its #', async () => {
    window.history.replaceState(null, '', '/tab?mock=1#sel=a');
    expect(await createWindowNavigation().getHash()).toBe('sel=a');
  });

  it('writes the hash in place, keeping path and query', () => {
    window.history.replaceState(null, '', '/tab?mock=1');
    const nav = createWindowNavigation();
    nav.setHash('q=vault');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/tab?mock=1#q=vault');
  });

  it('clears the hash entirely for the default view', () => {
    window.history.replaceState(null, '', '/tab#q=vault');
    createWindowNavigation().setHash('');
    expect(window.location.href.endsWith('/tab')).toBe(true);
  });

  it('reports hash changes until unsubscribed', () => {
    const seen: string[] = [];
    const stop = createWindowNavigation().subscribe((hash) => seen.push(hash));
    window.history.replaceState(null, '', '#one');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    stop();
    window.history.replaceState(null, '', '#two');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seen).toEqual(['one']);
  });
});

describe('host navigation', () => {
  function hostService() {
    let listener: ((hash: string) => void) | undefined;
    const service = {
      hash: '#sel=x',
      getHash: vi.fn(async function (this: { hash: string }) {
        return this.hash;
      }),
      setHash: vi.fn(),
      onHashChanged: vi.fn((cb: (hash: string) => void) => {
        listener = cb;
      }),
      fire: (hash: string) => listener?.(hash),
    };
    return service;
  }

  it('reads and writes through the host, with methods bound to it', async () => {
    const service = hostService();
    h.service = service;
    const nav = await createHostNavigation();
    expect(await nav.getHash()).toBe('sel=x');
    nav.setHash('q=1');
    expect(service.setHash).toHaveBeenCalledWith('q=1');
  });

  it('forwards host hash changes, and drops them once unsubscribed', async () => {
    const service = hostService();
    h.service = service;
    const nav = await createHostNavigation();
    const seen: string[] = [];
    const stop = nav.subscribe((hash) => seen.push(hash));
    service.fire('#a');
    stop();
    service.fire('#b');
    expect(seen).toEqual(['a']);
  });

  it('subscribes to nothing when the host cannot report changes', async () => {
    h.service = { getHash: async () => '', setHash: () => undefined };
    const nav = await createHostNavigation();
    const stop = nav.subscribe(() => {
      throw new Error('should never be called');
    });
    expect(stop()).toBeUndefined();
  });

  it('falls back to window when the service is unusable', async () => {
    h.service = { getHash: 'not a function' };
    window.history.replaceState(null, '', '/#from-window');
    expect(await (await createHostNavigation()).getHash()).toBe('from-window');
  });

  it('falls back to window when the host throws', async () => {
    h.throws = true;
    window.history.replaceState(null, '', '/#from-window');
    expect(await (await createHostNavigation()).getHash()).toBe('from-window');
  });
});
