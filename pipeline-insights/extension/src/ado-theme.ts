import { darkTheme, lightTheme, type Theme, type ThemeVariable } from '@pipeline-insights/ui';

/**
 * Azure DevOps's theme, as the SDK hands it over: variable names without `--`, values that are
 * either CSS colours or bare `R, G, B` triples (the `palette-*` family, and some others).
 */
export type AdoThemeData = Readonly<Record<string, string>>;

/** Which `--pi-*` variable reads which Azure DevOps variable. The rest come from the base palette. */
const FROM_ADO: Partial<Record<ThemeVariable, string>> = {
  '--pi-bg': 'background-color',
  '--pi-surface': 'callout-background-color',
  '--pi-raised': 'callout-background-color',
  '--pi-line': 'border-subtle-color',
  '--pi-line-strong': 'palette-neutral-20',
  '--pi-fg': 'text-primary-color',
  '--pi-muted': 'text-secondary-color',
  '--pi-faint': 'text-disabled-color',
  '--pi-accent': 'communication-background',
  // What Azure DevOps's own status icons read; ui's palettes hold their fallbacks.
  '--pi-ok': 'component-status-success',
  '--pi-fail': 'component-status-error',
  '--pi-partial': 'component-status-warning',
  '--pi-run': 'component-status-info',
};

/** The Azure DevOps variables `adoTheme` reads. */
export const ADO_THEME_KEYS: readonly string[] = [...new Set(Object.values(FROM_ADO))];

const TRIPLE = /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;

/** A CSS colour from a theme value; a bare triple becomes `rgb(…)`. */
export function cssColor(value: string): string {
  return TRIPLE.test(value) ? `rgb(${value.trim()})` : value.trim();
}

/** Relative luminance from 0 (black) to 1 (white), or null for a value it cannot read. */
export function luminance(value: string): number | null {
  const v = cssColor(value);
  let rgb: number[] | undefined;
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn?.[1]) rgb = fn[1].split(/[\s,/]+/).slice(0, 3).map(Number);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  if (!rgb || rgb.length < 3 || rgb.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = rgb.map((n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether a theme is dark, judged by its background, or failing that by its text. Values that
 * are not literal colours (a `var()`, say) cannot be judged here; the host resolves those in the
 * browser and passes `dark` to `adoTheme` instead.
 */
export function isDark(data: AdoThemeData | undefined): boolean {
  const bg = data?.['background-color'];
  const background = bg ? luminance(bg) : null;
  if (background !== null) return background < 0.4;
  const fg = data?.['text-primary-color'];
  const text = fg ? luminance(fg) : null;
  return text !== null && text > 0.5;
}

/**
 * The `--pi-*` variables for an Azure DevOps theme. Surfaces, lines and text follow Azure
 * DevOps, and so do succeeded, failed, partial and running, from the variables its own status
 * icons read. The other states have no Azure DevOps colour and come from ui's light or dark
 * palette, whichever the background calls for. The soft accent, used
 * for hover and pressed fills, is mixed from Azure DevOps's accent and surface so it always sits
 * in the theme on screen.
 */
export function adoTheme(data: AdoThemeData | undefined, dark: boolean = isDark(data)): Theme {
  const theme: Theme = { ...(dark ? darkTheme : lightTheme) };
  for (const [variable, key] of Object.entries(FROM_ADO) as [ThemeVariable, string][]) {
    const value = data?.[key];
    if (value) theme[variable] = cssColor(value);
  }
  const accent = data?.[FROM_ADO['--pi-accent'] ?? ''];
  const surface = data?.[FROM_ADO['--pi-surface'] ?? ''];
  if (accent && surface) {
    theme['--pi-accent-soft'] = `color-mix(in srgb, ${cssColor(accent)} ${dark ? 28 : 16}%, ${cssColor(surface)})`;
  }
  return theme;
}
