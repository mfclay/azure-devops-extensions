/**
 * `?mock=1` — the committed fixtures, no Azure and no Azure DevOps.
 *
 * Decision E4: roughly 95% of the UI work needs neither. Only the dev server
 * loads this module; `main.tsx` imports it behind `import.meta.env.DEV`, so a
 * production build drops it and every fixture with it.
 *
 * The mock estate deliberately includes a stage that produced **no attachment**.
 * The one correctness rule in this project is that such a stage renders loudly
 * rather than as "no changes", so the offline mode has to exercise it every time
 * someone opens the app, not only when a real pipeline happens to fail.
 */
import type { StageResult } from '../model/stage.js';
import type { LoadProgress, LoadResult, WhatIfSource } from './source.js';

// The timeline capture feeds the join tests; it is not a what-if payload.
const FIXTURES = import.meta.glob(['../../../core/fixtures/**/*.json', '!../../../core/fixtures/**/*-timeline-and-attachments.json']);

function stackIdFromPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.json$/, '').replace(/^build-\d+-/, '');
}

function pascal(stackId: string): string {
  return stackId
    .split('-')
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function createMockSource(): WhatIfSource {
  return {
    kind: 'mock',
    async load(onProgress?: (progress: LoadProgress) => void): Promise<LoadResult> {
      onProgress?.({ phase: 'finding' });
      const paths = Object.keys(FIXTURES).sort();
      const stages: StageResult[] = [];
      const notes: string[] = [];

      for (const [i, path] of paths.entries()) {
        onProgress?.({ phase: 'reading', read: i, total: paths.length });
        const loader = FIXTURES[path];
        if (!loader) continue;
        const stackId = stackIdFromPath(path);
        try {
          const mod = (await loader()) as { default?: unknown };
          stages.push({
            stageId: `WhatIf_${pascal(stackId)}`,
            displayName: stackId,
            state: 'completed',
            result: 'succeeded',
            stackId,
            payload: mod.default,
            sidecar: { schemaVersion: 1, stackId, status: 'succeeded', azCliVersion: '2.89.1' },
            notes: [],
          });
        } catch (err) {
          notes.push(`Fixture ${path} could not be loaded: ${String(err)}`);
        }
      }

      // A stage that ran, failed under `continueOnError: true`, and attached
      // nothing. Present in every mock run on purpose — see the module comment.
      stages.push({
        stageId: 'WhatIf_PlatformProd',
        displayName: 'Stack 3 — Shared Platform (prod)',
        state: 'completed',
        result: 'succeededWithIssues',
        stackId: 'platform-prod',
        sidecar: {
          schemaVersion: 1,
          stackId: 'platform-prod',
          status: 'failed',
          azCliVersion: '2.89.1',
          // ARM's error object, as the task writes it — not a string.
          error: {
            code: 'InvalidTemplate',
            message: "The template reference 'app-shared-infra' could not be resolved.",
          },
        },
        notes: [],
      });

      // ...and one that produced neither attachment nor sidecar, which is what a
      // cancelled build or a dead agent leaves behind.
      stages.push({
        stageId: 'WhatIf_WorkloadAlphaRegxProd',
        displayName: 'Client ALPHA — RegX (prod)',
        state: 'completed',
        result: 'canceled',
        notes: [],
      });

      notes.push(
        'Mock mode: committed fixtures from packages/core/fixtures, plus two synthetic ' +
          'stages with no attachment. Not a real build.',
      );

      return { stages, buildLabel: 'mock · fixtures from build 7700017', notes };
    },
  };
}
