import { SEVERITY_GLYPH, SEVERITY_TONE, type Severity } from '@bicep-whatif/core';

/** Severity mark. Glyphs come from `Types.ps1`, so this reads like the pipeline log. */
export function Glyph({ severity, title }: { severity: Severity; title?: string }): React.ReactElement {
  return (
    <span className="glyph" data-tone={SEVERITY_TONE[severity]} aria-hidden="true" title={title}>
      {SEVERITY_GLYPH[severity]}
    </span>
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
