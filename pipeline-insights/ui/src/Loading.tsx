import type { LoadProgress } from '@pipeline-insights/core';
import type { CSSProperties } from 'react';
import { styles } from './styles.js';

/** The strip's cells, coloured like a typical run history: mostly green, one failure, one wait. */
const CELLS = ['ok', 'ok', 'ok', 'ok', 'fail', 'ok', 'ok', 'ok', 'ok', 'wait', 'ok', 'ok', 'ok', 'ok', 'ok'] as const;

export interface LoadingPageProps {
  /** Shown in the subtitle, as on the page. */
  project: string;
  /** From `loadEstate()`'s `onProgress`; nothing is counted until the definitions are read. */
  progress?: LoadProgress | null;
}

/**
 * What a host shows before the first estate arrives: a run-history strip, drawn like a row's,
 * that fills in and starts again, with how many pipelines are ready so far.
 */
export function LoadingPage({ project, progress }: LoadingPageProps) {
  return (
    <div className="pi-root">
      <style href="pipeline-insights" precedence="default">
        {styles}
      </style>
      <div className="pi-page">
        <main className="pi-main">
          <div className="pi-head">
            <div>
              <h1>Pipeline Insights</h1>
              <div className="pi-sub">{project}</div>
            </div>
          </div>
          <div className="pi-loading" role="status">
            <div className="pi-loading-strip" aria-hidden="true">
              {CELLS.map((tone, i) => (
                <i key={i} style={{ '--pi-cell': `var(--pi-${tone})`, animationDelay: `${(i * 0.12).toFixed(2)}s` } as CSSProperties} />
              ))}
            </div>
            <div className="pi-loading-label">Reading pipelines and their runs</div>
            <div className="pi-loading-count pi-num">{progress && `${progress.ready} of ${progress.pipelines} pipelines`}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
