import type { StackView } from '../model/estate.js';

/**
 * The one correctness rule, said out loud (design §03, decision E3).
 *
 * What-if stages run `continueOnError: true`, so a stage that failed produces no
 * attachment and — without this — eight clean stacks would read as a safe
 * deploy while the ninth was never evaluated at all. The banner does not
 * dismiss: it describes a fact about the run, not an event.
 */
export function NotEvaluatedBanner({ stacks }: { stacks: readonly StackView[] }): React.ReactElement | null {
  const unevaluated = stacks.filter((s) => !s.evaluated);
  if (unevaluated.length === 0) return null;

  return (
    <div className="banner" role="status">
      <span className="banner__glyph" aria-hidden="true">
        ?
      </span>
      <div>
        <p className="banner__text">
          <strong>
            {unevaluated.length} {unevaluated.length === 1 ? 'stack was' : 'stacks were'} not evaluated.
          </strong>{' '}
          {unevaluated.length === 1 ? 'It' : 'They'} produced no what-if result, so nothing is known about{' '}
          {unevaluated.length === 1 ? 'it' : 'them'} — treat that as unknown, not as unchanged.
        </p>
        <p className="banner__stacks">{unevaluated.map((s) => s.label).join(' · ')}</p>
      </div>
    </div>
  );
}
