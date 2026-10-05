import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createMockSource } from './data/mock.js';
import type { WhatIfSource } from './data/source.js';
import { createHostNavigation, createWindowNavigation, type Navigation } from './nav/navigation.js';
import './styles/theme.css';
import './styles/app.css';

/**
 * `?mock=1` is decision E4 and stays in the shipped bundle deliberately: it is
 * the fastest bug-repro channel this project has. Someone with a broken tab can
 * open the same build's URL with `?mock=1` and immediately tell a rendering bug
 * from a data problem.
 */
function isMock(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

async function start(): Promise<void> {
  const mock = isMock();

  // **Before anything else that touches the SDK.** `createHostNavigation()`
  // below calls `getService`, which waits on this handshake and hangs rather
  // than throwing if it has not happened — see `data/sdk.ts`.
  if (!mock) await (await import('./data/sdk.js')).ensureSdkReady();

  const source: WhatIfSource = mock
    ? createMockSource()
    : (await import('./data/ado.js')).createAdoSource();
  const navigation: Navigation = mock ? createWindowNavigation() : await createHostNavigation();

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root');

  createRoot(container).render(
    <StrictMode>
      <App source={source} navigation={navigation} />
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
