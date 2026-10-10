import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { aboutOf, MOCK_ABOUT, type About } from './data/about.js';
import type { WhatIfSource } from './data/source.js';
import { createHostNavigation, createWindowNavigation, type Navigation } from './nav/navigation.js';
import './styles/theme.css';
import './styles/app.css';

/**
 * `?mock=1` is decision E4, and it exists only under `npm run dev`.
 * `import.meta.env.DEV` is a literal `false` in a production build, so the
 * bundler drops `data/mock.ts` and the fixture chunks its glob would emit; the
 * VSIX ships no fixtures. `scripts/package.mjs` refuses one that does.
 */
function isMock(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

/** The installed extension and version, for the footer. Never throws: a tab without it still works. */
async function readAbout(): Promise<About> {
  try {
    const SDK = await import('azure-devops-extension-sdk');
    return aboutOf(SDK.getExtensionContext());
  } catch {
    return aboutOf(undefined);
  }
}

async function start(): Promise<void> {
  const mock = import.meta.env.DEV && isMock();

  // **Before anything else that touches the SDK.** `createHostNavigation()`
  // below calls `getService`, which waits on this handshake and hangs rather
  // than throwing if it has not happened — see `data/sdk.ts`.
  if (!mock) await (await import('./data/sdk.js')).ensureSdkReady();

  const source: WhatIfSource = mock
    ? (await import('./data/mock.js')).createMockSource()
    : (await import('./data/ado.js')).createAdoSource();
  const navigation: Navigation = mock ? createWindowNavigation() : await createHostNavigation();
  const about = mock ? MOCK_ABOUT : await readAbout();

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root');

  createRoot(container).render(
    <StrictMode>
      <App source={source} navigation={navigation} about={about} />
    </StrictMode>,
  );

  if (!mock) {
    // Tell the host the tab has painted. Skipped in mock mode, where there is no
    // host. This is the other half of `init({ loaded: false })` above: without
    // it the host spins and eventually reports the tab as slow to load.
    const SDK = await import('azure-devops-extension-sdk');
    SDK.notifyLoadSucceeded();
  }
}

void start();
