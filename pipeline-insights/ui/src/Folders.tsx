import {
  describeLine,
  isRetired,
  MAIN_BRANCH,
  PIPELINE_STATES,
  runOutcome,
  type Lines,
  type Pipeline,
  type PipelineAnalysis,
  type PipelineRun,
  type PipelineState,
} from '@pipeline-insights/core';
import type { KeyboardEvent, ReactNode } from 'react';
import { OUTCOME_DISPLAY, reasonLabel, STATE_DISPLAY, stageWord } from './display.js';
import { folderEntries, isLineOpen, type FolderEntry, type LineEntry } from './entries.js';
import { ago, duration, folderTitle, percent } from './format.js';
import { Dot, StageStrip, StateIcon } from './parts.js';

const HISTORY = 15;
const order = (s: PipelineState) => PIPELINE_STATES.indexOf(s);

interface Props {
  pipelines: PipelineAnalysis[];
  lines: Lines;
  query: string;
  filter: PipelineState | null;
  mainOnly: boolean;
  now: number;
  open: Record<string, boolean>;
  openLines: Record<string, boolean>;
  onToggleFolder(folder: string, open: boolean): void;
  onToggleLine(line: string, open: boolean): void;
  onOpen(pipelineId: number): void;
}

/** Opened or closed by hand wins; otherwise every block is open. */
export const isFolderOpen = (open: Record<string, boolean>, folder: string) => open[folder] ?? true;

/** One block per pipeline folder; worst state first within a block. */
export function Folders({ pipelines, lines, query, filter, mainOnly, now, open, openLines, onToggleFolder, onToggleLine, onOpen }: Props) {
  const entries = folderEntries(pipelines, lines, { query, filter });
  const row = { mainOnly, now, onOpen };

  const blocks = [...entries].map(([folder, list]) => {
    const isOpen = isFolderOpen(open, folder);
    const counts = new Map<PipelineState, number>();
    const here = pipelines.filter((a) => a.pipeline.folder === folder);
    for (const a of here) if (!isRetired(a.pipeline)) counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
    const archived = here.filter((a) => a.pipeline.facts.archived).length;
    const disabled = here.filter((a) => isRetired(a.pipeline)).length - archived;
    return (
      <section key={folder} className="pi-panel pi-folder" data-open={isOpen}>
        <button type="button" className="pi-folder-head" aria-expanded={isOpen} onClick={() => onToggleFolder(folder, !isOpen)}>
          <Chevron />
          <span className="pi-fname">{folderTitle(folder)}</span>
          <span className="pi-fsum">
            {[...counts.keys()]
              .sort((x, y) => order(x) - order(y))
              .map((s) => (
                <span key={s}>
                  <Dot tone={STATE_DISPLAY[s].swatch} />
                  {counts.get(s)} {STATE_DISPLAY[s].label.toLowerCase()}
                </span>
              ))}
            {archived > 0 && <span>{archived} archived</span>}
            {disabled > 0 && <span>{disabled} disabled</span>}
          </span>
        </button>
        {isOpen && (
          <div className="pi-rows-scroll">
            <div>
              <div className="pi-cols">
                <span />
                <span>Pipeline</span>
                <span>Last {HISTORY} runs (oldest → newest)</span>
                <span>Latest run</span>
                <span>Success · median</span>
              </div>
              {list.map((e: FolderEntry) =>
                e.kind === 'pipeline' ? (
                  <PipelineRow key={e.analysis.pipeline.id} a={e.analysis} {...row} />
                ) : (
                  <LineGroup
                    key={e.line.name}
                    entry={e}
                    estate={pipelines.map((a) => a.pipeline)}
                    open={isLineOpen(openLines, e)}
                    onToggle={(next) => onToggleLine(e.line.name, next)}
                    {...row}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </section>
    );
  });

  return (
    <div className="pi-folders">
      {blocks.length ? blocks : <div className="pi-panel pi-empty">No pipelines match the filter.</div>}
    </div>
  );
}

interface RowProps {
  mainOnly: boolean;
  now: number;
  onOpen(id: number): void;
}

/**
 * A line: one summary row while closed, which speaks for its headline member, and a header with
 * one row per member while open.
 */
function LineGroup({ entry, estate, open, onToggle, mainOnly, now, onOpen }: RowProps & {
  entry: LineEntry;
  estate: Pipeline[];
  open: boolean;
  onToggle(open: boolean): void;
}) {
  const { line, members, headline } = entry;
  const roles = new Map(line.pipelines.map((m) => [m.id, m.role]));
  const role = (a: PipelineAnalysis) => roles.get(a.pipeline.id) ?? a.pipeline.name;
  const last = members[members.length - 1]!;
  const notes = members.flatMap((m) => (m.pipeline.facts.otherRepos ?? []).map((repo) => ({ who: role(m), repo })));

  return (
    <>
      <div
        className={entry.retired ? 'pi-row pi-line-head pi-retired' : 'pi-row pi-line-head'}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-label={`${line.name} line`}
        onClick={() => onToggle(!open)}
        onKeyDown={activate(() => onToggle(!open))}
      >
        <StateIcon tone={STATE_DISPLAY[entry.state].tone} />
        <div style={{ minWidth: 0 }}>
          <div className="pi-pname">
            <Chevron closed={!open} />
            {line.name} <span className="pi-tag pi-tag-line">line · {members.length}</span>
            {entry.retired && <RetiredTags pipelines={members.map((m) => m.pipeline)} />}
          </div>
          <div className="pi-purpose">{last.pipeline.facts.purpose || <em>No purpose set</em>}</div>
          <div className="pi-chain">{describeLine(line, estate)}</div>
          {notes.map((n) => (
            <div key={`${n.who}:${n.repo}`} className="pi-chain">
              {n.who} also runs on pushes to {repoName(n.repo)}
            </div>
          ))}
        </div>
        {open ? (
          <>
            <div />
            <div className="pi-latest">{members.length} pipelines</div>
            <div />
          </>
        ) : (
          <>
            <div className="pi-stack">
              {members.map((m) => (
                <div key={m.pipeline.id}>
                  <span className="pi-stack-role">{role(m)}</span>
                  <History runs={m.runs} now={now} />
                </div>
              ))}
            </div>
            <Latest a={headline} mainOnly={mainOnly} now={now} prefix={role(headline)} />
            <Rate a={headline} />
          </>
        )}
      </div>
      {open && members.map((m) => <PipelineRow key={m.pipeline.id} a={m} role={role(m)} mainOnly={mainOnly} now={now} onOpen={onOpen} />)}
    </>
  );
}

/** A lone pipeline, or with `role` one member of an open line. */
function PipelineRow({ a, role, mainOnly, now, onOpen }: RowProps & { a: PipelineAnalysis; role?: string }) {
  const p = a.pipeline;
  const member = role !== undefined;
  return (
    <div
      className={`pi-row${member ? ' pi-member' : ''}${isRetired(p) ? ' pi-retired' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`${p.name} details`}
      onClick={() => onOpen(p.id)}
      onKeyDown={activate(() => onOpen(p.id))}
    >
      <StateIcon tone={STATE_DISPLAY[a.state].tone} />
      <div className={member ? 'pi-who' : undefined} style={{ minWidth: 0 }}>
        <div className="pi-pname">
          {member && <span className="pi-role">{role}</span>}
          {p.name}
          {isRetired(p) && (
            <>
              {' '}
              <RetiredTags pipelines={[p]} />
            </>
          )}
        </div>
        {!member && (
          <>
            <div className="pi-purpose">{p.facts.purpose || <em>No purpose set</em>}</div>
            {p.facts.runsAfter && <div className="pi-chain">Runs after {p.facts.runsAfter}</div>}
            {p.facts.otherRepos?.map((repo) => (
              <div key={repo} className="pi-chain">
                Also runs on pushes to {repoName(repo)}
              </div>
            ))}
          </>
        )}
      </div>
      <History runs={a.runs} now={now} />
      <Latest a={a} mainOnly={mainOnly} now={now} />
      <Rate a={a} />
    </div>
  );
}

/** Why a row is quiet: archived in its metadata file, disabled in Azure DevOps, or both. */
function RetiredTags({ pipelines }: { pipelines: Pipeline[] }) {
  const archived = pipelines.some((p) => p.facts.archived);
  const disabled = pipelines.some((p) => p.disabled);
  return (
    <>
      {archived && (
        <span className="pi-tag" title="Archived in its metadata file: not counted, and raises nothing">
          archived
        </span>
      )}
      {archived && disabled && ' '}
      {disabled && (
        <span className="pi-tag" title="Disabled in Azure DevOps: not counted, and raises nothing">
          disabled
        </span>
      )}
    </>
  );
}

function History({ runs: all, now }: { runs: PipelineRun[]; now: number }) {
  const runs = all.slice(0, HISTORY).reverse();
  return (
    <div className="pi-hist">
      {Array.from({ length: HISTORY - runs.length }, (_, i) => (
        <i key={`blank-${i}`} className="pi-blank" />
      ))}
      {runs.map((r) => {
        const outcome = OUTCOME_DISPLAY[runOutcome(r)];
        return (
          <i
            key={r.id}
            className={`pi-s-${outcome.tone}${r.branch !== MAIN_BRANCH ? ' pi-pr' : ''}`}
            data-tip={`${r.number} · ${outcome.label} · ${reasonLabel(r.reason)} · ${r.branch} · ${ago(r.queued, now)}`}
          />
        );
      })}
    </div>
  );
}

function Latest({ a, mainOnly, now, prefix }: { a: PipelineAnalysis; mainOnly: boolean; now: number; prefix?: string }) {
  const show = a.waiting[0] ?? a.active[0] ?? a.lastRun;
  const who: ReactNode = prefix ? <b>{prefix} · </b> : null;
  if (!show) {
    return (
      <div className="pi-latest">
        <span className="pi-line1">
          {who}No runs{mainOnly ? ' on main' : ''}
        </span>
      </div>
    );
  }
  const stages = show.stages ?? [];
  const hot =
    stages.find((s) => s.waitingForApproval) ?? stages.find((s) => s.result === 'failed') ?? stages.find((s) => s.state === 'inProgress');
  return (
    <div className="pi-latest">
      <span className="pi-line1">
        {who}
        {OUTCOME_DISPLAY[runOutcome(show)].word} · {reasonLabel(show.reason)} · {ago(show.finished || show.queued, now)}
      </span>
      {stages.length > 1 && <StageStrip stages={stages} />}
      {hot && (
        <span>
          {hot.name}: {stageWord(hot)}
        </span>
      )}
    </div>
  );
}

function Rate({ a }: { a: PipelineAnalysis }) {
  return (
    <div className="pi-rate">
      <b className="pi-num">{percent(a.successRate)}</b>
      <span className="pi-num">
        {a.judgedRuns} runs · {duration(a.medianDurationMs)}
      </span>
    </div>
  );
}

function Chevron({ closed }: { closed?: boolean }) {
  return (
    <svg className={closed ? 'pi-chev pi-chev-closed' : 'pi-chev'} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** `Shop/Orders.Deployment` → `Orders.Deployment`. */
const repoName = (repo: string) => repo.split('/').pop() ?? repo;

const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};
