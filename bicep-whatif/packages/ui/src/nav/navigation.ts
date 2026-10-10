/**
 * Reading and writing the URL hash.
 *
 * The tab renders inside an iframe the host owns, so `window.location.hash`
 * belongs to the extension frame, not to the address bar a reviewer would copy.
 * Azure DevOps exposes a navigation service for exactly this. It is
 * feature-detected rather than assumed: the host contract has moved between SDK
 * versions, and a deep link that silently writes to the wrong frame is worse
 * than one that falls back to `window` and says so.
 */

export interface Navigation {
  getHash(): Promise<string>;
  setHash(hash: string): void;
  subscribe(onChange: (hash: string) => void): () => void;
  /** Open a page of Azure DevOps itself, such as a stage's log, in a new tab. */
  openUrl(url: string): void;
}

function openInWindow(url: string): void {
  window.open(url, '_blank', 'noopener');
}

export function createWindowNavigation(): Navigation {
  return {
    getHash: () => Promise.resolve(window.location.hash.replace(/^#/, '')),
    setHash(hash) {
      const next = hash.length > 0 ? `#${hash}` : '';
      const url = `${window.location.pathname}${window.location.search}${next}`;
      window.history.replaceState(null, '', url);
    },
    subscribe(onChange) {
      const handler = (): void => {
        onChange(window.location.hash.replace(/^#/, ''));
      };
      window.addEventListener('hashchange', handler);
      return () => {
        window.removeEventListener('hashchange', handler);
      };
    },
    openUrl: openInWindow,
  };
}

/**
 * `CommonServiceIds.HostNavigationService` is declared as an ambient `const
 * enum`, so it has no runtime object to read and `isolatedModules` forbids
 * inlining it. The literal below is that member's value, verbatim from
 * `azure-devops-extension-api/Common/CommonServices.d.ts`.
 */
const HOST_NAVIGATION_SERVICE_ID = 'ms.vss-features.host-navigation-service';

interface HostNavigationServiceLike {
  getHash: () => Promise<string>;
  setHash: (hash: string) => void;
  onHashChanged?: ((cb: (hash: string) => void) => void) | undefined;
  /** Opens a new browser tab from the host page, where the tab's own frame may not be allowed to. */
  openNewWindow?: ((url: string, features: string) => void) | undefined;
}

function isUsable(service: unknown): service is HostNavigationServiceLike {
  const s = service as Partial<HostNavigationServiceLike> | null;
  return typeof s?.getHash === 'function' && typeof s.setHash === 'function';
}

/**
 * Wrap the host navigation service, falling back to `window` when the host does
 * not provide one. Never throws — a tab that cannot deep-link is still a working
 * tab, and losing the grid over a URL feature would be a bad trade.
 */
export async function createHostNavigation(): Promise<Navigation> {
  try {
    // Through the shared handshake, not a bare import: `getService` waits on
    // `init()` and hangs — not throws — if it has not happened, so the `catch`
    // below would never fire and the whole startup would stall here.
    const SDK = await (await import('../data/sdk.js')).ensureSdkReady();
    const service: unknown = await SDK.getService(HOST_NAVIGATION_SERVICE_ID);
    if (!isUsable(service)) return createWindowNavigation();

    const getHash = service.getHash.bind(service);
    const setHash = service.setHash.bind(service);
    const onHashChanged = service.onHashChanged?.bind(service);
    const openNewWindow = service.openNewWindow?.bind(service);

    return {
      getHash: async () => (await getHash()).replace(/^#/, ''),
      setHash,
      subscribe(onChange) {
        if (!onHashChanged) return () => undefined;
        let live = true;
        onHashChanged((hash) => {
          if (live) onChange(hash.replace(/^#/, ''));
        });
        // The host offers no unsubscribe; the guard is what stops a stale
        // callback writing into an unmounted tree.
        return () => {
          live = false;
        };
      },
      openUrl: (url) => {
        if (openNewWindow) openNewWindow(url, '');
        else openInWindow(url);
      },
    };
  } catch {
    return createWindowNavigation();
  }
}
