import { explainItem, type AttentionItem, type NoOwnerItem, type WindowDays } from '@pipeline-insights/core';
import { ITEM_TONE } from './display.js';
import { ago } from './format.js';
import type { InsightsLinks } from './links.js';
import { PhraseView, StateIcon } from './parts.js';

const LIMIT = 6;

/** Every item but the no-owner count, which the setup panel carries. */
export type PipelineItem = Exclude<AttentionItem, NoOwnerItem>;

interface Props {
  items: PipelineItem[];
  windowDays: WindowDays;
  now: number;
  links: InsightsLinks;
  showAll: boolean;
  onToggleShowAll(): void;
  onOpen(pipelineId: number): void;
}

/** The page's main job: one sentence per problem, most urgent first. */
export function Attention({ items, windowDays, now, links, showAll, onToggleShowAll, onOpen }: Props) {
  const shown = showAll ? items : items.slice(0, LIMIT);
  return (
    <section className="pi-panel" aria-labelledby="pi-attn-h">
      <div className="pi-panel-head">
        <h2 id="pi-attn-h">
          Needs attention <span className="pi-count">{items.length}</span>
        </h2>
        <span className="pi-hint">Most urgent first</span>
      </div>
      <ul className="pi-attn">
        {!items.length && <li className="pi-attn-note">Nothing needs attention.</li>}
        {shown.map((item, n) => (
          <li key={n}>
            <StateIcon tone={ITEM_TONE[item.kind]} />
            <div>
              <div className="pi-what">
                <button type="button" onClick={() => onOpen(item.pipelineId)}>
                  {item.pipelineName}
                </button>
                {' · '}
                {item.title}
              </div>
              <div className="pi-why">
                <PhraseView phrase={explainItem(item, { windowDays })} />
              </div>
            </div>
            <div className="pi-age">
              {ago(item.since, now)}
              {item.runId === null ? (
                <a href={links.pipeline(item.pipelineId)} target="_blank" rel="noopener">
                  Open pipeline
                </a>
              ) : (
                <a href={links.run(item.runId)} target="_blank" rel="noopener">
                  Open run
                </a>
              )}
            </div>
          </li>
        ))}
        {items.length > LIMIT && (
          <li className="pi-more">
            <button type="button" onClick={onToggleShowAll}>
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
