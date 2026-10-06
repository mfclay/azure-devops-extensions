import { describe, expect, it } from 'vitest';
import { codeSpans, outcomePhrase, scheduleDays } from '../src/index.js';

describe('wording helpers', () => {
  it('shows backticked parts of a message as code', () => {
    expect(codeSpans('`pipelines:` should map each path.')).toEqual([{ code: 'pipelines:' }, ' should map each path.']);
    expect(codeSpans('No literals here.')).toEqual(['No literals here.']);
  });

  it('ends a sentence with what became of a run, never an API value', () => {
    expect(outcomePhrase('succeeded')).toBe('succeeded');
    expect(outcomePhrase('inProgress')).toBe('is still running');
    expect(outcomePhrase('somethingNew')).toBe('something new');
  });

  it('names a schedule’s days', () => {
    expect(scheduleDays('all')).toBe('every day');
    expect(scheduleDays(127)).toBe('every day');
    expect(scheduleDays(31)).toBe('weekdays');
    expect(scheduleDays('saturday, sunday')).toBe('weekends');
    expect(scheduleDays(5)).toBe('Monday, Wednesday');
    expect(scheduleDays(undefined)).toBe('');
    expect(scheduleDays(0)).toBe('no days');
    expect(scheduleDays('none')).toBe('no days');
    // A value it does not recognise is shown as the API gave it, not as "no days".
    expect(scheduleDays(' fortnightly ')).toBe('fortnightly');
  });
});
