/**
 * Azure's diagnostics in plain words. What matters: a known code gets its own
 * sentence, an unknown one still says something, and plain never means the
 * deletion risk Azure leads with goes unsaid.
 */
import { describe, expect, it } from 'vitest';
import { diagnosticsDisclosure, firstSentence, incompleteCallout, warningLines } from '../src/model/diagnostics.js';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

function stackFrom(path: string, edit?: (payload: { properties: { diagnostics: Record<string, unknown>[] } }) => void) {
  const payload = structuredClone(fixture(path)) as { properties: { diagnostics: Record<string, unknown>[] } };
  edit?.(payload);
  const stage: StageResult = { stageId: 'WhatIf_X', displayName: 'X', stackId: 'x', payload, notes: [] };
  const [stack] = buildEstateView([stage]).stacks;
  if (!stack) throw new Error('no stack');
  return stack;
}

describe('the closed stack line', () => {
  it('says a short-circuit cannot rule out deletes when Azure marked rows potential', () => {
    expect(warningLines(stackFrom('synthetic/synthetic-short-circuit.json'))).toEqual([
      "Result may be incomplete — Azure couldn't resolve a resource id, so it can't rule out deletes.",
    ]);
  });

  it('says only that it may be incomplete when nothing is potential', () => {
    // smoke-81 short-circuited on a stack with nothing in it yet.
    expect(warningLines(stackFrom('real/smoke-81-short-circuit.json'))).toEqual([
      "Result may be incomplete — Azure couldn't resolve a resource id before the deploy.",
    ]);
  });

  it('has no all-caps text', () => {
    for (const line of warningLines(stackFrom('real/smoke-85-short-circuit-after-create.json'))) {
      expect(line).not.toMatch(/[A-Z]{4,}/);
    }
  });

  it('still says something for a code it does not know', () => {
    const stack = stackFrom('real/smoke-81-short-circuit.json', (p) => {
      p.properties.diagnostics = [
        { level: 'warning', code: 'SomethingNew', message: 'THE RESULT MAY BE STALE. Re-run to be sure.' },
      ];
    });
    expect(warningLines(stack)).toEqual(['The result may be stale.']);
  });

  it('says nothing for info', () => {
    const stack = stackFrom('real/smoke-81-short-circuit.json', (p) => {
      p.properties.diagnostics = [{ level: 'info', code: 'Fyi', message: 'Just so you know.' }];
    });
    expect(warningLines(stack)).toEqual([]);
  });
});

describe('the opened stack', () => {
  it('leads with what a short-circuit means, without claiming how many ids', () => {
    const callout = incompleteCallout(stackFrom('synthetic/synthetic-short-circuit.json'));
    expect(callout?.title).toBe("This result isn't complete.");
    expect(callout?.body).toMatch(/^Azure couldn't resolve one or more resource ids before the deploy\./);
  });

  it('has no callout without a warning', () => {
    const stack = stackFrom('real/smoke-81-short-circuit.json', (p) => {
      p.properties.diagnostics = [];
    });
    expect(incompleteCallout(stack)).toBeUndefined();
  });

  it('counts what the disclosure opens', () => {
    const stack = stackFrom('synthetic/synthetic-short-circuit.json');
    expect(diagnosticsDisclosure(stack.stack?.diagnostics ?? [])).toBe("Show Azure's messages (1 warning, 1 info)");
  });
});

describe('firstSentence', () => {
  it('keeps mixed case as Azure wrote it', () => {
    expect(firstSentence('Resource Foo in RG-A was skipped. More text.')).toBe('Resource Foo in RG-A was skipped.');
  });

  it('takes the whole message when it has no full stop', () => {
    expect(firstSentence('no punctuation here')).toBe('no punctuation here');
  });
});
