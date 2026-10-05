/**
 * The host handshake, performed exactly once.
 *
 * `SDK.init()` opens the channel to the extension host. **Every other SDK call
 * waits on it** — `getService`, `getConfiguration`, `getClient` and
 * `notifyLoadSucceeded` all await the handshake internally — so anything that
 * touches the SDK before `init()` does not fail, it *hangs*. That distinction is
 * what makes the mistake expensive: a `try`/`catch` around the call looks like
 * it handles the problem and does not, because an unresolved promise never
 * reaches a `catch`.
 *
 * That is not hypothetical. The first run of this tab in a real organisation
 * deadlocked: `createHostNavigation()` called `getService` before anything had
 * called `init()`, so it never settled, the render below it never happened, and
 * the `notifyLoadSucceeded()` after that was unreachable. The host showed
 * "Deployment Stack What-If Viewer (dev) is taking longer than expected to
 * load" and spun forever — a message that points at load *time* and says
 * nothing about ordering.
 *
 * Centralising it here means there is one place that can be got wrong, and it
 * is memoised so that repeated calls are free and — more importantly — a second
 * `init()` can never reset the `loaded: false` contract half way through
 * startup.
 *
 * `{ loaded: false }` means "do not mark this tab loaded yet; I will say when".
 * The promise to keep in exchange is `notifyLoadSucceeded()`, in `main.tsx`,
 * after the first render. Without that call the host waits and then shows the
 * same banner — so the two belong together conceptually even though they sit in
 * different files.
 */

type Sdk = typeof import('azure-devops-extension-sdk');

let handshake: Promise<Sdk> | undefined;

export function ensureSdkReady(): Promise<Sdk> {
  handshake ??= (async () => {
    const SDK = await import('azure-devops-extension-sdk');
    await SDK.init({ loaded: false });
    await SDK.ready();
    return SDK;
  })();
  return handshake;
}

/** Test seam: forget the memoised handshake. Not used by the app. */
export function resetSdkForTests(): void {
  handshake = undefined;
}
