/**
 * @vitest-environment jsdom
 *
 * The bootstrap, end to end against a stub host. `sdkHandshake.test.ts` proves
 * the pieces; this proves `main.tsx` puts them in the right order: handshake,
 * then navigation, then render, then — and only then — `notifyLoadSucceeded`.
 * Get the first pair backwards and the tab hangs; drop the last and the host
 * spins and calls the tab slow.
 *
 * As there, the stub throws where a real host would hang, so a regression fails
 * here instead of timing out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The first import of `main.tsx` transforms the whole tab, which can take
 * longer than `waitFor`'s one-second default when every suite runs at once.
 */
const SETTLE = { timeout: 10_000 };

const h = vi.hoisted(() => ({ calls: [] as string[], initialised: false, rendered: [] as unknown[] }));

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
    if (!h.initialised) throw new Error('getService before init — in a real host this hangs forever');
    return { getHash: async () => '', setHash: () => undefined };
  },
  notifyLoadSucceeded: (): void => {
    h.calls.push('notifyLoadSucceeded');
  },
  getExtensionContext: () => ({ id: 'MichaelC.bicep-whatif-dev', version: '1.0.8' }),
}));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (element: unknown) => {
      h.calls.push('render');
      h.rendered.push(element);
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  h.calls.length = 0;
  h.initialised = false;
  h.rendered.length = 0;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

/** The `<App>` element inside `<StrictMode>`, for its props. */
type Props = { source: { kind: string }; navigation: unknown; about?: string };

function appProps(): Props {
  const strict = h.rendered[0] as { props: { children: { props: Props } } };
  return strict.props.children.props;
}

describe('main', () => {
  it('handshakes, then navigates, then renders, then tells the host', async () => {
    await import('../src/main.js');
    await vi.waitFor(() => {
      expect(h.calls).toContain('notifyLoadSucceeded');
    }, SETTLE);
    expect(h.calls).toEqual(['init', 'ready', 'getService', 'render', 'notifyLoadSucceeded']);
    expect(appProps().source.kind).toBe('ado');
    // The footer's line, from the host: which extension, at which version.
    expect(appProps().about).toBe('MichaelC.bicep-whatif-dev 1.0.8');
  });

  it('touches no host at all in mock mode', async () => {
    window.history.replaceState(null, '', '/?mock=1');
    await import('../src/main.js');
    await vi.waitFor(() => {
      expect(h.calls).toContain('render');
    }, SETTLE);
    // Give a stray notifyLoadSucceeded the chance to arrive before asserting it did not.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls).toEqual(['render']);
    expect(appProps().source.kind).toBe('mock');
    expect(appProps().about).toBe('mock mode, no installed extension');
  });
});
