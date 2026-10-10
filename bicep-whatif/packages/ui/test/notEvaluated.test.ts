/**
 * What an opened, never-evaluated stack says. The constraint under test: it
 * states what the build shows (the stage's result, the task's error) and claims
 * no cause the tab cannot see.
 */
import { describe, expect, it } from 'vitest';
import { buildEstateView, type StackView } from '../src/model/estate.js';
import { notEvaluatedDetail, resultName, stageLogUrl } from '../src/model/notEvaluated.js';

function stackOf(stage: Parameters<typeof buildEstateView>[0][number]): StackView {
  const stack = buildEstateView([stage]).stacks[0];
  if (!stack) throw new Error('no stack');
  return stack;
}

describe('notEvaluatedDetail', () => {
  it('says nothing for a stack that was evaluated', () => {
    const evaluated = { ...stackOf({ stageId: 'WhatIf_A', displayName: 'A', notes: [] }), evaluated: true };
    expect(notEvaluatedDetail(evaluated)).toBeUndefined();
  });

  it('keeps the code apart from the message when the what-if failed', () => {
    const detail = notEvaluatedDetail(
      stackOf({
        stageId: 'WhatIf_PlatformProd',
        displayName: 'Stack 3 — Shared Platform (prod)',
        stackId: 'platform-prod',
        result: 'succeededWithIssues',
        sidecar: { status: 'failed', error: { code: 'InvalidTemplate', message: 'The template could not be resolved.' } },
        notes: [],
      }),
    )!;
    expect(detail.why).toBe('The what-if step failed before Azure returned a result.');
    expect(detail.error).toEqual({ code: 'InvalidTemplate', message: 'The template could not be resolved.' });
    expect(detail.stageOutcome).toBe('finished SucceededWithIssues');
    expect(detail.stageOutcome).not.toMatch(/continueOnError/);
  });

  it('says the stage attached nothing when there is no failed sidecar, and gives no error', () => {
    const detail = notEvaluatedDetail(stackOf({ stageId: 'WhatIf_A', displayName: 'A', notes: [] }))!;
    expect(detail.why).toBe('The stage attached no what-if result.');
    expect(detail.error).toBeUndefined();
    expect(detail.stageOutcome).toBeUndefined();
  });

  it('links to the log only when it knows both the build page and the stage record', () => {
    const results = 'https://dev.azure.com/contoso/Platform/_build/results?buildId=21';
    const withRecord = stackOf({ stageId: 'WhatIf_A', displayName: 'A', recordId: 'rec-1', notes: [] });
    expect(notEvaluatedDetail(withRecord, results)?.logUrl).toBe(`${results}&view=logs&s=rec-1`);
    expect(notEvaluatedDetail(withRecord)?.logUrl).toBeUndefined();
    const withoutRecord = stackOf({ stageId: 'WhatIf_A', displayName: 'A', notes: [] });
    expect(notEvaluatedDetail(withoutRecord, results)?.logUrl).toBeUndefined();
  });
});

describe('resultName', () => {
  it('names a result as the build page does, from a name or a TaskResult number', () => {
    expect(resultName('succeededWithIssues')).toBe('SucceededWithIssues');
    expect(resultName('1')).toBe('SucceededWithIssues');
    expect(resultName('2')).toBe('Failed');
    expect(resultName('9')).toBe('9');
  });
});

describe('stageLogUrl', () => {
  it('adds to a query string, or starts one', () => {
    expect(stageLogUrl('https://x/_build/results?buildId=1', 'r')).toBe('https://x/_build/results?buildId=1&view=logs&s=r');
    expect(stageLogUrl('https://x/_build/results', 'r')).toBe('https://x/_build/results?view=logs&s=r');
  });
});
