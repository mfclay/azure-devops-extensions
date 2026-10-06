import type { Lines, Pipeline, Stage } from '@pipeline-insights/core';
import { describe, expect, it } from 'vitest';
import { reasonLabel, stageTone, stageWord } from '../src/display.js';
import { relatedFor } from '../src/related.js';

const stage = (over: Partial<Stage>): Stage => ({ name: 'Deploy', state: 'completed', result: 'succeeded', waitingForApproval: false, ...over });

describe('reasonLabel', () => {
  it('names why a run started, in words for one Insights does not know', () => {
    expect(reasonLabel('individualCI')).toBe('CI');
    expect(reasonLabel('resourceTrigger')).toBe('After pipeline');
    expect(reasonLabel('checkInShelveset')).toBe('Gated check-in');
    expect(reasonLabel('somethingNewer')).toBe('Something newer');
    expect(reasonLabel(null)).toBe('');
  });
});

describe('a stage as words and a tone', () => {
  it('reads a finished stage with no result as done, and an unknown result as pending', () => {
    expect(stageWord(stage({ result: null }))).toBe('done');
    expect(stageTone(stage({ result: null }))).toBe('pending');
    expect(stageWord(stage({ result: 'abandoned' }))).toBe('abandoned');
    expect(stageTone(stage({ result: 'abandoned' }))).toBe('pending');
    expect(stageWord(stage({ state: null, result: null }))).toBe('');
  });
});

describe('relatedFor', () => {
  const pipeline = (id: number, name: string): Pipeline => ({ id, name, folder: '\\', repo: 'web', yamlPath: `${name}.yaml`, disabled: false, runs: [], facts: {} });
  const estate = [pipeline(1, 'storefront-build'), pipeline(2, 'shop-deploy'), pipeline(3, 'shop-ci')];

  it('says which folder links two pipelines whose names do not', () => {
    const lines: Lines = { lines: [], suggestions: [{ pipelines: [1, 2], signal: 'folder', folder: 'src/storefront' }] };
    expect(relatedFor(lines, estate, 2)).toEqual({
      suggestions: [{ target: 'storefront-build', why: 'Both CI triggers watch src/storefront, but the names have different stems.' }],
    });
  });

  it('points at the other pipeline’s line when it has one', () => {
    const lines: Lines = {
      lines: [
        {
          name: 'shop',
          folder: '\\',
          formedBy: [],
          pipelines: [
            { id: 3, role: 'ci', runsAfter: [], step: 0 },
            { id: 2, role: 'deploy', runsAfter: [], step: 0 },
          ],
        },
      ],
      suggestions: [{ pipelines: [1, 2], signal: 'name' }],
    };
    expect(relatedFor(lines, estate, 1).suggestions.map((s) => s.target)).toEqual(['the shop line']);
    expect(relatedFor(lines, estate, 2).line).toBe('shop: ci, deploy');
  });
});
