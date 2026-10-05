import type { AttentionItem, PipelineState, RunOutcome, Stage } from '@pipeline-insights/core';

/**
 * Words and colour classes for what core decides. Nothing here judges a pipeline; it only names
 * and colours the judgement.
 */

/** A colour: `pi-ico-<tone>` for icons, `pi-s-<tone>` for squares, dots and segments. */
export type Tone = 'ok' | 'fail' | 'wait' | 'run' | 'cancel' | 'partial' | 'idle' | 'never' | 'info' | 'pending' | 'skip';

export const STATE_DISPLAY: Record<PipelineState, { label: string; tone: Tone; swatch: Tone }> = {
  failing: { label: 'Failing', tone: 'fail', swatch: 'fail' },
  waiting: { label: 'Waiting for approval', tone: 'wait', swatch: 'wait' },
  running: { label: 'Running', tone: 'run', swatch: 'run' },
  partiallySucceeded: { label: 'Partially succeeded', tone: 'partial', swatch: 'partial' },
  canceled: { label: 'Last run canceled', tone: 'cancel', swatch: 'cancel' },
  idle: { label: 'Idle 30+ days', tone: 'idle', swatch: 'idle' },
  healthy: { label: 'Healthy', tone: 'ok', swatch: 'ok' },
  onlyBranches: { label: 'Only run from branches', tone: 'never', swatch: 'pending' },
  neverRun: { label: 'Never run', tone: 'never', swatch: 'pending' },
};

export const OUTCOME_DISPLAY: Record<RunOutcome, { word: string; label: string; tone: Tone }> = {
  succeeded: { word: 'Succeeded', label: 'Succeeded', tone: 'ok' },
  failed: { word: 'Failed', label: 'Failed', tone: 'fail' },
  partiallySucceeded: { word: 'Partially succeeded', label: 'Partially succeeded', tone: 'partial' },
  canceled: { word: 'Canceled', label: 'Canceled', tone: 'cancel' },
  waiting: { word: 'Waiting', label: 'Waiting for approval', tone: 'wait' },
  running: { word: 'Running', label: 'Running', tone: 'run' },
};

export const ITEM_TONE: Record<AttentionItem['kind'], Tone> = {
  failing: 'fail',
  waiting: 'wait',
  unreliable: 'partial',
  idle: 'idle',
  yamlMissing: 'partial',
  noOwner: 'info',
};

const REASONS: Record<string, string> = {
  batchedCI: 'CI',
  individualCI: 'CI',
  manual: 'Manual',
  pullRequest: 'PR',
  schedule: 'Scheduled',
  resourceTrigger: 'After pipeline',
};

export const reasonLabel = (reason: string | null) => (reason ? (REASONS[reason] ?? reason) : '');

const STAGE_RESULT_TONES: Record<string, Tone> = {
  succeeded: 'ok',
  failed: 'fail',
  canceled: 'cancel',
  skipped: 'skip',
  succeededWithIssues: 'partial',
  partiallySucceeded: 'partial',
};

export function stageTone(s: Stage): Tone {
  if (s.waitingForApproval) return 'wait';
  if (s.state === 'inProgress') return 'run';
  if (s.state === 'pending') return 'pending';
  return (s.result && STAGE_RESULT_TONES[s.result]) || 'pending';
}

export function stageWord(s: Stage): string {
  if (s.waitingForApproval) return 'waiting for approval';
  return s.state === 'completed' ? s.result || 'done' : (s.state ?? '');
}
