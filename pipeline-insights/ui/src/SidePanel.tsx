import { CATALOG_NAME, codeSpans, isRetired, runOutcome, type PipelineAnalysis, type PipelineFacts, type Stage, type WindowDays } from '@pipeline-insights/core';
import { useEffect, useRef, useState } from 'react';
import { OUTCOME_DISPLAY, reasonLabel, STATE_DISPLAY, stageTone, stageWord } from './display.js';
import { ago, duration, folderTitle, percent } from './format.js';
import type { InsightsLinks } from './links.js';
import type { Related } from './related.js';
import { PhraseView, StateIcon, TriggerLine } from './parts.js';

interface Props {
  a: PipelineAnalysis;
  windowDays: WindowDays;
  mainOnly: boolean;
  now: number;
  links: InsightsLinks;
  loadStages?: ((runId: number) => Promise<Stage[] | null>) | undefined;
  /** Its line and suggestions, once the metadata has loaded. */
  related?: Related | undefined;
  onClose(): void;
}

/** One pipeline's detail, over the right of the page. Escape or the scrim closes it. */
export function SidePanel({ a, windowDays, mainOnly, now, links, loadStages, related, onClose }: Props) {
  const p = a.pipeline;
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const owner = p.facts.owner && p.facts.owner.toUpperCase() !== 'TODO' ? p.facts.owner : null;
  const documented = p.facts.described || p.facts.purposeSource === 'catalog';
  const mark = p.facts.purpose ? purposeMark(p.facts) : null;
  const runs = a.runs.slice(0, 10);

  // Stages of the shown runs that the estate came without, by run id; null where unreadable.
  const [loaded, setLoaded] = useState<ReadonlyMap<number, Stage[] | null>>(new Map());
  const missing = loadStages ? runs.filter((r) => r.stages === null).map((r) => r.id) : [];
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!loadStages || !missingKey) return;
    let live = true;
    for (const id of missingKey.split(',').map(Number)) {
      loadStages(id).then(
        (stages) => live && setLoaded((m) => new Map(m).set(id, stages)),
        () => live && setLoaded((m) => new Map(m).set(id, null)),
      );
    }
    return () => {
      live = false;
    };
  }, [loadStages, missingKey]);
  const stagesOf = (r: (typeof runs)[number]) => r.stages ?? loaded.get(r.id) ?? null;
  const pending = missing.filter((id) => !loaded.has(id)).length;
  const unreadable = missing.filter((id) => loaded.has(id) && loaded.get(id) === null).length;

  return (
    <>
      <div className="pi-scrim" onClick={onClose} />
      <aside className="pi-drawer" role="dialog" aria-modal="true" aria-labelledby="pi-d-title">
        <header>
          <button ref={close} type="button" className="pi-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
          <div className="pi-drawer-state">
            <StateIcon tone={STATE_DISPLAY[a.state].tone} />
            <span>
              {STATE_DISPLAY[a.state].label} · {folderTitle(p.folder)}
            </span>
          </div>
          <h3 id="pi-d-title">{p.name}</h3>
          <div className="pi-drawer-links">
            <a href={links.pipeline(p.id)} target="_blank" rel="noopener">
              Open in Pipelines
            </a>
            {p.yamlPath && (
              <a href={links.yaml(p)} target="_blank" rel="noopener">
                View YAML
              </a>
            )}
            {p.facts.metadataFile ? (
              <a href={links.file(p, p.facts.metadataFile)} target="_blank" rel="noopener">
                {documented ? 'Edit description' : 'Add a description'}
              </a>
            ) : (
              p.facts.metadataFolder !== undefined && (
                <a href={links.file(p, p.facts.metadataFolder)} target="_blank" rel="noopener" title={`Create ${CATALOG_NAME} here`}>
                  Add a description
                </a>
              )
            )}
          </div>
        </header>
        <div className="pi-dbody">
          {isRetired(p) && (
            <div className="pi-suggest">
              <div>
                <b>{p.facts.archived ? `Archived in ${p.facts.metadataFile ?? CATALOG_NAME}.` : 'Disabled in Azure DevOps.'}</b> It raises
                nothing in Needs attention and counts toward no total.
              </div>
            </div>
          )}
          {related?.suggestions.map((s) => (
            <div key={s.target} className="pi-suggest">
              <div>
                <b>Looks related to {s.target}.</b> Set <code>component</code> on both to group them.
              </div>
              <div className="pi-why">{s.why}</div>
            </div>
          ))}
          <dl className="pi-kv">
            <dt>Purpose</dt>
            <dd>
              {p.facts.purpose ?? 'No description'}
              {mark && (
                <>
                  {' '}
                  <span className="pi-tag" title={mark.title}>
                    {mark.label}
                  </span>
                </>
              )}
            </dd>
            <dt>Owner</dt>
            <dd>{owner ?? <span className="pi-tag">not set</span>}</dd>
            {p.facts.category && (
              <>
                <dt>Category</dt>
                <dd>{p.facts.category}</dd>
              </>
            )}
            {related?.line && (
              <>
                <dt>Line</dt>
                <dd>{related.line}</dd>
              </>
            )}
            {p.facts.component && (
              <>
                <dt>Component</dt>
                <dd>{p.facts.component}</dd>
              </>
            )}
            <dt>Triggers</dt>
            <dd>
              {p.facts.triggers?.length ? (
                <ul>
                  {p.facts.triggers.map((t, i) => (
                    <li key={i}>
                      <TriggerLine line={t} />
                    </li>
                  ))}
                </ul>
              ) : (
                '—'
              )}
            </dd>
            <dt>YAML</dt>
            <dd>{p.yamlPath ? `${p.repo}: ${p.yamlPath}` : '—'}</dd>
            {p.facts.metadataProblems?.length ? (
              <>
                <dt>To fix</dt>
                <dd>
                  <ul>
                    {p.facts.metadataProblems.map((problem, i) => (
                      <li key={i}>
                        <PhraseView phrase={codeSpans(problem)} />
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
            <dt>Last {windowDays} days</dt>
            <dd>
              {a.judgedRuns} runs · {a.successRate === null ? '—' : `${percent(a.successRate)} succeeded`} · median{' '}
              {duration(a.medianDurationMs)}
            </dd>
          </dl>
          {p.facts.details && (
            <div>
              <h4>Notes</h4>
              <div className="pi-notes">{p.facts.details}</div>
            </div>
          )}
          <div>
            <h4>Recent runs{mainOnly ? ' on main' : ''}</h4>
            <ul className="pi-runlist">
              {!runs.length && <li className="pi-attn-note">No runs.</li>}
              {runs.map((r) => {
                const outcome = OUTCOME_DISPLAY[runOutcome(r)];
                return (
                  <li key={r.id}>
                    <StateIcon tone={outcome.tone} />
                    <div>
                      <div className="pi-rn">
                        <a href={links.run(r.id)} target="_blank" rel="noopener">
                          {r.number}
                        </a>
                      </div>
                      <div className="pi-rm">
                        {reasonLabel(r.reason)} · {r.branch}
                        {r.started && r.finished ? ` · ${duration(Date.parse(r.finished) - Date.parse(r.started))}` : ''}
                      </div>
                      {missing.includes(r.id) && !loaded.has(r.id) && (
                        <span className="pi-stages-pending" role="status" aria-label="Loading stages">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {(stagesOf(r)?.length ?? 0) > 1 && (
                        <div className="pi-stage-list">
                          {stagesOf(r)?.map((s, i) => (
                            <div key={i} className={s.waitingForApproval || s.result === 'failed' ? 'pi-hot' : undefined}>
                              <i className={`pi-s-${stageTone(s)}`} />
                              <span>
                                {s.name} · {stageWord(s)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="pi-rt">{ago(r.finished || r.queued, now)}</div>
                  </li>
                );
              })}
            </ul>
            {!loadStages && runs.some((r) => r.stages === null) && (
              <p className="pi-footnote">Stages are loaded for the newest run and any unfinished one.</p>
            )}
            {pending === 0 && unreadable > 0 && (
              <p className="pi-footnote">
                Stages could not be read for {unreadable === 1 ? 'one run' : `${unreadable} runs`}.
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/** How sure the purpose is: drafted and not yet confirmed, or read from somewhere other than a description. */
function purposeMark(facts: PipelineFacts): { label: string; title: string } | null {
  if (facts.purposeSource === 'derived') return { label: 'derived', title: "From the YAML's opening comment" };
  if (facts.purposeSource === 'structural') return { label: 'summary', title: 'From the triggers and the newest run' };
  if (facts.draft) return { label: 'draft', title: 'Marked (TODO: verify) where it is written' };
  return null;
}
