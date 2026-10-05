/** A run as the mockup reads it. Stages are `[name, state, result, waitingForApproval]`. */
export interface MockupRun {
  id: number;
  status: string;
  result: string | null;
  branch: string;
  queued: string;
  started: string | null;
  finished: string | null;
  stages: [string, string | null, string | null, boolean][] | null;
}

export interface MockupPipeline {
  id: number;
  name: string;
  folder: string;
  disabled: boolean;
  /** Archived or disabled. Not a field the mockup reads: the wrapper leaves these pipelines out of its totals. */
  retired: boolean;
  owner: string;
  triggers: string[];
  runs: MockupRun[];
}

export interface MockupData {
  generated: string;
  pipelines: MockupPipeline[];
}

export interface MockupAnalysis {
  p: MockupPipeline;
  waiting: MockupRun[];
  st: 'fail' | 'wait' | 'run' | 'partial' | 'cancel' | 'idle' | 'ok' | 'offmain' | 'never';
  rate: number | null;
  judged: number;
  failedN: number;
  median: number | null;
  windowRuns: number;
}

export interface MockupItem {
  sev: number;
  k: 'fail' | 'wait' | 'partial' | 'idle' | 'info';
  a?: MockupAnalysis;
  when?: string;
  run?: number;
  what: string;
  why: string;
}

export function runMockup(
  DATA: MockupData,
  view: { days: number; mainOnly: boolean },
): { all: MockupAnalysis[]; items: MockupItem[]; runState: (r: MockupRun) => MockupAnalysis['st'] };
