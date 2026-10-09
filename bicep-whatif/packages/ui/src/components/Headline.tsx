import type { Headline as HeadlineText } from '../model/summary.js';

/**
 * The answer the tab opens on, in a sentence.
 *
 * It took over from the not-evaluated and diagnostics banners, and keeps their
 * rule: a stack that was not evaluated, or whose result Azure called
 * incomplete, is stated here in words for as long as it is true. It does not
 * dismiss and no filter changes it.
 */
export function Headline({ headline }: { headline: HeadlineText }): React.ReactElement {
  return (
    <div className="headline" role="status" aria-label="Summary">
      <p className="headline__lead">{headline.lead}</p>
      <p className="headline__detail">{headline.detail}</p>
    </div>
  );
}
