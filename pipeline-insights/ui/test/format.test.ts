import { describe, expect, it } from 'vitest';
import { ago, asOf, clock, duration, folderTitle } from '../src/format.js';
import { darkTheme, lightTheme, THEME_VARIABLES } from '../src/theme.js';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe('format', () => {
  it('says how long ago in the largest sensible unit', () => {
    expect(ago(before(45 * 6e4), NOW)).toBe('45m ago');
    expect(ago(before(5 * 36e5), NOW)).toBe('5h ago');
    expect(ago(before(17 * 864e5), NOW)).toBe('17d ago');
    expect(ago(before(90 * 864e5), NOW)).toBe('3mo ago');
    expect(ago(null, NOW)).toBe('');
  });

  it('formats durations', () => {
    expect(duration(42e3)).toBe('42s');
    expect(duration(12 * 6e4)).toBe('12m');
    expect(duration(1.5 * 36e5)).toBe('1.5h');
    expect(duration(null)).toBe('—');
  });

  it('titles folders', () => {
    expect(folderTitle('\\services\\production')).toBe('services \\ production');
    expect(folderTitle('\\')).toBe('(root)');
    expect(asOf(NOW)).toBe('Sat, 03 Oct 2026 12:00 UTC');
    expect(clock(NOW + 10e3)).toBe('12:00:10 UTC');
  });
});

describe('themes', () => {
  it('set every variable the stylesheet reads', () => {
    for (const theme of [lightTheme, darkTheme]) expect(Object.keys(theme).sort()).toEqual([...THEME_VARIABLES].sort());
  });
});
