import { describe, expect, it } from 'vitest';
import { WINDOW_DAYS } from '../src/index.js';

describe('WINDOW_DAYS', () => {
  it('offers 7, 14 and 30 days, shortest first', () => {
    expect(WINDOW_DAYS).toEqual([7, 14, 30]);
  });
});
