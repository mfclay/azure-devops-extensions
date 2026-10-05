import { darkTheme, lightTheme, THEME_VARIABLES } from '@pipeline-insights/ui';
import { describe, expect, it } from 'vitest';
import { adoTheme, cssColor, isDark, luminance } from '../src/ado-theme.js';

const light = {
  'background-color': 'rgba(255, 255, 255, 1)',
  'callout-background-color': 'rgba(255, 255, 255, 1)',
  'text-primary-color': 'rgba(0, 0, 0, .9)',
  'palette-neutral-20': '200, 200, 200',
  'communication-background': '0, 120, 212',
};
const dark = { ...light, 'background-color': 'rgba(32, 31, 30, 1)', 'text-primary-color': 'rgba(255, 255, 255, .9)' };

describe('adoTheme', () => {
  it('sets every variable the stylesheet reads, with or without theme data', () => {
    for (const data of [undefined, {}, light, dark]) {
      expect(Object.keys(adoTheme(data)).sort()).toEqual([...THEME_VARIABLES].sort());
    }
  });

  it("falls back to ui's light palette without theme data", () => {
    expect(adoTheme(undefined)).toEqual(lightTheme);
  });

  it('judges a theme whose background is not a literal colour by its text', () => {
    const indirect = { ...dark, 'background-color': 'var(--palette-neutral-0)' };
    expect(isDark(indirect)).toBe(true);
    expect(isDark({ ...light, 'background-color': 'var(--palette-neutral-0)' })).toBe(false);
  });

  it("takes the host's verdict on dark over its own", () => {
    expect(adoTheme(light, true)['--pi-wait']).toBe(darkTheme['--pi-wait']);
  });

  it("takes the status colours Azure DevOps's own icons use, when the theme sets them", () => {
    const t = adoTheme({ ...dark, 'component-status-success': 'rgba(85, 163, 98, 1)', 'component-status-error': '205, 74, 69' });
    expect(t['--pi-ok']).toBe('rgba(85, 163, 98, 1)');
    expect(t['--pi-fail']).toBe('rgb(205, 74, 69)');
    expect(t['--pi-run']).toBe(darkTheme['--pi-run']);
  });

  it('mixes the soft accent from the theme, so hover fills match it', () => {
    expect(adoTheme(dark)['--pi-accent-soft']).toBe('color-mix(in srgb, rgb(0, 120, 212) 28%, rgba(255, 255, 255, 1))');
    expect(adoTheme(light)['--pi-accent-soft']).toBe('color-mix(in srgb, rgb(0, 120, 212) 16%, rgba(255, 255, 255, 1))');
  });

  it('follows Azure DevOps for surfaces and text, wrapping bare triples', () => {
    const t = adoTheme(light);
    expect(t['--pi-bg']).toBe('rgba(255, 255, 255, 1)');
    expect(t['--pi-fg']).toBe('rgba(0, 0, 0, .9)');
    expect(t['--pi-line-strong']).toBe('rgb(200, 200, 200)');
    expect(t['--pi-accent']).toBe('rgb(0, 120, 212)');
    expect(t['--pi-fail']).toBe(lightTheme['--pi-fail']);
  });

  it('takes state colours from the dark palette on a dark background', () => {
    expect(isDark(dark)).toBe(true);
    expect(isDark(light)).toBe(false);
    expect(adoTheme(dark)['--pi-wait']).toBe(darkTheme['--pi-wait']);
    expect(adoTheme(dark)['--pi-bg']).toBe('rgba(32, 31, 30, 1)');
  });

  it('reads colours in the forms Azure DevOps uses', () => {
    expect(cssColor(' 1, 2, 3 ')).toBe('rgb(1, 2, 3)');
    expect(luminance('#fff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('rgb(0 0 0 / 50%)')).toBe(0);
    expect(luminance('var(--x)')).toBeNull();
  });
});
