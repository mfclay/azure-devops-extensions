/**
 * The page reads colours and fonts only from these CSS custom properties. Each host sets them on
 * an ancestor of the page: the extension maps them from Azure DevOps's theme, the dev page uses
 * the sets below, and any other host would map its own tokens.
 */
export const THEME_VARIABLES = [
  '--pi-font',
  /** Code, such as the description header the setup panel shows. */
  '--pi-mono',
  '--pi-bg',
  '--pi-surface',
  '--pi-raised',
  '--pi-line',
  '--pi-line-strong',
  '--pi-fg',
  '--pi-muted',
  '--pi-faint',
  '--pi-accent',
  '--pi-accent-soft',
  '--pi-accent-fg',
  '--pi-ok',
  '--pi-fail',
  '--pi-wait',
  '--pi-run',
  '--pi-cancel',
  '--pi-idle',
  '--pi-partial',
  '--pi-fail-bg',
  '--pi-wait-bg',
  '--pi-idle-bg',
  /** Icon glyphs drawn on a state colour. */
  '--pi-on-state',
  '--pi-scrim',
  '--pi-shadow',
] as const;

export type ThemeVariable = (typeof THEME_VARIABLES)[number];
export type Theme = Record<ThemeVariable, string>;

const font = '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, sans-serif';

/**
 * Azure DevOps's own status colours: what its pipeline status icons fall back to when the host
 * sets no `--component-status-*` variable, the same in light and dark. Waiting for approval has
 * no Azure DevOps colour, so it keeps the mockup's amber.
 */
const STATUS = { ok: '#55a362', fail: '#cd4a45', partial: '#d67f3c', run: '#0078d4' };

/** Azure DevOps's light palette, as the mockup drew it, with its status colours. */
export const lightTheme: Theme = {
  '--pi-font': font,
  '--pi-mono': '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  '--pi-bg': '#f8f8f8',
  '--pi-surface': '#ffffff',
  '--pi-raised': '#ffffff',
  '--pi-line': '#e6e6e6',
  '--pi-line-strong': '#c8c8c8',
  '--pi-fg': '#201f1e',
  '--pi-muted': '#605e5c',
  '--pi-faint': '#8a8886',
  '--pi-accent': '#0078d4',
  '--pi-accent-soft': '#deecf9',
  '--pi-accent-fg': '#ffffff',
  '--pi-ok': STATUS.ok,
  '--pi-fail': STATUS.fail,
  '--pi-wait': '#b86e00',
  '--pi-run': STATUS.run,
  '--pi-cancel': '#8a8886',
  '--pi-idle': '#a19f9d',
  '--pi-partial': STATUS.partial,
  '--pi-fail-bg': '#fbe9e8',
  '--pi-wait-bg': '#fdf0dc',
  '--pi-idle-bg': '#f0f0f0',
  '--pi-on-state': '#ffffff',
  '--pi-scrim': 'rgba(0, 0, 0, 0.25)',
  '--pi-shadow': '0 6px 24px rgba(0, 0, 0, 0.14)',
};

/** Azure DevOps's dark palette, as the mockup drew it, with the same status colours. */
export const darkTheme: Theme = {
  ...lightTheme,
  '--pi-bg': '#1b1a19',
  '--pi-surface': '#252423',
  '--pi-raised': '#2d2c2b',
  '--pi-line': '#3b3a39',
  '--pi-line-strong': '#4f4e4d',
  '--pi-fg': '#f3f2f1',
  '--pi-muted': '#c8c6c4',
  '--pi-faint': '#979593',
  '--pi-accent': '#4ba0e8',
  '--pi-accent-soft': '#1f3447',
  '--pi-accent-fg': '#0b1a28',
  '--pi-wait': '#f2b04c',
  '--pi-cancel': '#979593',
  '--pi-idle': '#7a7876',
  '--pi-fail-bg': '#3d2423',
  '--pi-wait-bg': '#3d2f17',
  '--pi-idle-bg': '#323130',
  '--pi-shadow': '0 6px 24px rgba(0, 0, 0, 0.5)',
};
