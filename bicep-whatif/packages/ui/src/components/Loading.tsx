import { SEVERITY_TONE, type Severity } from '@bicep-whatif/core';
import type { LoadProgress } from '../data/source.js';
import { Glyph } from './Glyph.js';

/**
 * The sketch's lines: a rung for each line's mark, how wide its name bar is,
 * and which of the six count columns hold a bar. Fixed, so the sketch looks
 * like a stack list without pretending to be this build's.
 */
const LINES: readonly { severity: Severity; nameWidth: number; counts: readonly boolean[] }[] = [
  { severity: 'destructive', nameWidth: 168, counts: [true, false, false, true, false, true] },
  { severity: 'protectionLoss', nameWidth: 236, counts: [false, true, false, true, false, true] },
  { severity: 'create', nameWidth: 204, counts: [false, false, true, true, false, true] },
  { severity: 'modify', nameWidth: 252, counts: [false, false, false, true, false, true] },
  { severity: 'unevaluated', nameWidth: 140, counts: [false, false, false, false, true, false] },
  { severity: 'modify', nameWidth: 188, counts: [false, false, false, true, false, true] },
  { severity: 'noChange', nameWidth: 156, counts: [false, false, false, false, false, true] },
  { severity: 'noChange', nameWidth: 220, counts: [false, false, false, false, false, true] },
];

/** The column heads, in the stack list's order: worst first. */
const COLUMNS: readonly Severity[] = ['destructive', 'protectionLoss', 'create', 'modify', 'unevaluated', 'noChange'];

/** How many of the sketch's lines have settled, in proportion to the stacks read. */
export function settledLines(progress: LoadProgress, lines = LINES.length): number {
  if (progress.phase !== 'reading' || progress.total === 0) return 0;
  return Math.min(lines, Math.round((progress.read / progress.total) * lines));
}

export function progressText(progress: LoadProgress): string {
  if (progress.phase === 'finding') return 'Finding the what-if stages';
  const { read, total } = progress;
  return `${String(read)} of ${String(total)} ${total === 1 ? 'stack' : 'stacks'} read`;
}

/**
 * What the tab shows while it reads the build, laid out where the page will be:
 * the headline's place says what it is doing, the totals' place counts, and a
 * sketch of the stack list lights each line's mark in turn. Lines settle as
 * stacks are read. It fades in after a moment (in CSS), so a quick build never
 * flashes it.
 */
export function Loading({ progress }: { progress: LoadProgress }): React.ReactElement {
  const settled = settledLines(progress);
  const reading = progress.phase === 'reading' && progress.total > 0;
  const fraction = reading ? progress.read / progress.total : 0;
  return (
    <div className="loading">
      <header className="summary" role="status">
        <p className="headline__lead loading__lead">Reading the build&rsquo;s what-if results</p>
        <div className="loading__progress">
          <span>{progressText(progress)}</span>
          {reading && (
            <span className="loading__meter" aria-hidden="true">
              <span style={{ width: `${String(Math.round(fraction * 100))}%` }} />
            </span>
          )}
        </div>
      </header>

      <div className="loading__toolbar" aria-hidden="true">
        <span className="loading__bar" style={{ width: 96 }} />
        <span className="loading__bar" style={{ width: 84 }} />
        <span className="loading__bar" style={{ width: 260 }} />
      </div>

      <div className="loading__list" aria-hidden="true">
        <div className="stacks__head">
          <span />
          <span />
          <span>Stack</span>
          {COLUMNS.map((severity) => (
            <span key={severity} className="loading__colhead">
              <Glyph severity={severity} size={18} decorative />
            </span>
          ))}
        </div>
        {LINES.map((line, i) => {
          const done = i < settled;
          return (
            <div key={i} className="stack loading__line" data-settled={done}>
              <span className="loading__bar loading__chev" />
              {/* The slot carries the colour and its animation; an unsettled mark inherits it. */}
              <span
                className="loading__markslot"
                data-tone={SEVERITY_TONE[line.severity]}
                style={{ animationDelay: `${(i * 0.3).toFixed(1)}s` }}
              >
                <Glyph severity={line.severity} decorative className="loading__mark" />
              </span>
              <span className="loading__bar" style={{ width: line.nameWidth }} />
              {line.counts.map((on, c) => (
                <span key={c}>{on && <span className="loading__bar loading__count" />}</span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
