import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'fixtures');

export const load = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), 'utf8'));

/** Captured from Azure DevOps build 7700017, identifiers scrubbed. See fixtures/README.md. */
export const REAL_NETWORK = () => load('real/build-7700017-app-network.json');
export const REAL_SHARED_INFRA = () => load('real/build-7700017-app-shared-infra.json');

/** Hand-authored. No live stack produces a Detach or a Delete. */
export const SYNTH_SEVERITY = () => load('synthetic/synthetic-destructive-and-protection-loss.json');
export const SYNTH_DRIFT = () => load('synthetic/synthetic-schema-drift.json');
