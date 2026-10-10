import { SEVERITY_GLYPH, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';

/**
 * The marks, drawn on a 16-unit grid with a round-capped stroke in
 * `currentColor`, so each takes its rung's tone from the stylesheet. Inlined:
 * the tab has no icon dependency and seven paths don't justify one.
 */
const PATHS: Readonly<Record<Severity | 'warning', string>> = Object.freeze({
  destructive: 'M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.7 8.7h6.6l.7-8.7M6.7 7v4M9.3 7v4',
  protectionLoss: 'M8 1.8l5 1.9v3.8c0 3-2.1 5.4-5 6.7c-2.9-1.3-5-3.7-5-6.7V3.7z M4.2 12.3L11.8 3.6',
  create: 'M8 1.8a6.2 6.2 0 1 0 0 12.4a6.2 6.2 0 1 0 0-12.4z M8 5v6M5 8h6',
  modify: 'M10.5 2.3l3.2 3.2L6 13.2H2.8V10z M9 3.8l3.2 3.2',
  unevaluated:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4a6.2 6.2 0 1 0 0-12.4z M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.5 M8 11.3v.2',
  noChange: 'M4 6.3h8M4 9.7h8',
  warning: 'M8 2.2l6.2 11H1.8z M8 6.5v3.2 M8 11.3v.2',
});

/** 20 in the mark column, 18 in the menu and legend, 16 inline with text. */
export type IconSize = 16 | 18 | 20;

function Icon(props: {
  path: string;
  size: IconSize;
  className: string;
  tone: string;
  label?: string | undefined;
  title?: string | undefined;
}): React.ReactElement {
  return (
    <svg
      className={props.className}
      data-tone={props.tone}
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      // The stroke scales with the icon, so the inline size gets a heavier one to sit with the text.
      strokeWidth={props.size === 16 ? 1.5 : 1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(props.label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': props.label })}
    >
      {props.title !== undefined && <title>{props.title}</title>}
      <path d={props.path} />
    </svg>
  );
}

/**
 * Severity mark: an icon here, `core`'s text glyph in the log. The tooltip
 * names both ("Destructive (-)") so the two can be matched up. `label` replaces
 * the rung's word where the context says more, as "not evaluated" does for a
 * stack that never ran. `decorative` drops the name where the word sits beside it.
 */
export function Glyph(props: {
  severity: Severity;
  size?: IconSize;
  label?: string | undefined;
  decorative?: boolean;
  className?: string;
}): React.ReactElement {
  const label = props.label ?? SEVERITY_LABEL[props.severity];
  const named = props.decorative !== true;
  return (
    <Icon
      path={PATHS[props.severity]}
      size={props.size ?? 20}
      className={props.className === undefined ? 'glyph' : `glyph ${props.className}`}
      tone={SEVERITY_TONE[props.severity]}
      label={named ? label : undefined}
      title={named ? `${label.charAt(0).toUpperCase()}${label.slice(1)} (${SEVERITY_GLYPH[props.severity]})` : undefined}
    />
  );
}

/** The triangle on a note line: an Azure warning, or deny settings that weaken. */
export function WarningIcon(): React.ReactElement {
  return <Icon path={PATHS.warning} size={16} className="glyph glyph--note" tone="warning" label="warning" />;
}

/**
 * The open/closed mark on anything that expands: one chevron, turned a
 * quarter when open. Drawn rather than typed, because the ▸ character came out
 * at a few pixels, in the faintest grey, and was missed. Decorative: the
 * control around it carries `aria-expanded`.
 */
export function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      className="chev"
      data-open={open}
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5L10.5 8L6 12.5" />
    </svg>
  );
}

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = Object.freeze({
  destructive: 'destructive',
  protectionLoss: 'protection loss',
  create: 'new',
  modify: 'modified',
  // Resources Azure could not predict. A stack that never ran is "not evaluated";
  // that is said of stacks, never of a resource count.
  unevaluated: 'not predicted',
  noChange: 'unchanged',
});
