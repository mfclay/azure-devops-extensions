import { PIPELINE_STATES, type EstateSummary, type PipelineState, type WindowDays } from '@pipeline-insights/core';
import { STATE_DISPLAY } from './display.js';
import { notCounted } from './format.js';
import { Dot } from './parts.js';

interface Props {
  summary: EstateSummary;
  windowDays: WindowDays;
  filter: PipelineState | null;
  onFilter(state: PipelineState): void;
}

/** The whole estate in one glance: a bar and a count per state, each a filter. */
export function EstateHealth({ summary, windowDays, filter, onFilter }: Props) {
  const states = PIPELINE_STATES.filter((s) => summary.counts[s]);
  const { judgedRuns: judged, failedRuns: failed } = summary;
  const { archived, disabled } = summary.retired;
  return (
    <section className="pi-panel" aria-labelledby="pi-health-h">
      <div className="pi-panel-head">
        <h2 id="pi-health-h">Estate health</h2>
        <span className="pi-hint">{filter ? 'Filtered · click again to clear' : 'Click a state to filter'}</span>
      </div>
      <div className="pi-health">
        <div className="pi-bar" aria-hidden="true">
          {states.map((s) => (
            <span key={s} className={`pi-s-${STATE_DISPLAY[s].swatch}`} style={{ flex: summary.counts[s] }} />
          ))}
        </div>
        <div className="pi-legend">
          {states.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filter === s}
              aria-label={`${summary.counts[s]} ${STATE_DISPLAY[s].label}`}
              onClick={() => onFilter(s)}
            >
              <Dot tone={STATE_DISPLAY[s].swatch} />
              <span className="pi-n pi-num">{summary.counts[s]}</span>
              <span className="pi-l">{STATE_DISPLAY[s].label}</span>
            </button>
          ))}
        </div>
        <div className="pi-stats">
          <div>
            <b className="pi-num">{summary.windowRuns}</b>
            <span>runs, last {windowDays} days</span>
          </div>
          <div>
            <b className="pi-num">{judged ? `${Math.round((100 * (judged - failed)) / judged)}%` : '—'}</b>
            <span>succeeded</span>
          </div>
          <div>
            <b className="pi-num">{summary.waitingRuns}</b>
            <span>runs waiting for approval</span>
          </div>
        </div>
        {archived + disabled > 0 && <div className="pi-hint">Not counted: {notCounted(archived, disabled)}.</div>}
      </div>
    </section>
  );
}
