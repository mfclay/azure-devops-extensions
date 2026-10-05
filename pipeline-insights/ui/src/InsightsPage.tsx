import { inferLines, pipelineState, summarizeEstate, WINDOW_DAYS, type Pipeline, type PipelineState, type Stage, type WindowDays } from '@pipeline-insights/core';
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Attention, type PipelineItem } from './Attention.js';
import { EstateHealth } from './EstateHealth.js';
import { FolderPicker } from './FolderPicker.js';
import { Folders } from './Folders.js';
import { asOf, folderTitle } from './format.js';
import type { InsightsLinks } from './links.js';
import { QuickFilter } from './parts.js';
import { relatedFor } from './related.js';
import { folderOptions, inFolder, inScope, quickFilters, scopeLines, type Scope } from './scope.js';
import { setupStatus, type SetupFacts } from './setup.js';
import { SetupPanel, type About, type RepoSearch } from './SetupPanel.js';
import { SidePanel } from './SidePanel.js';
import { styles } from './styles.js';

/**
 * What the viewer has chosen. Hosts may set any of it up front: the hub sets `folder` from the
 * page address.
 */
export interface InsightsView extends Scope {
  windowDays: WindowDays;
  mainOnly: boolean;
  query: string;
  filter: PipelineState | null;
  /** Folders opened or closed by hand; the rest are open. */
  open: Record<string, boolean>;
  /** Lines opened or closed by hand, by name; the rest open when a member needs attention. */
  openLines: Record<string, boolean>;
  showAllAttention: boolean;
}

export const DEFAULT_VIEW: InsightsView = {
  windowDays: 14,
  mainOnly: true,
  folder: null,
  repo: null,
  category: null,
  component: null,
  query: '',
  filter: null,
  open: {},
  openLines: {},
  showAllAttention: false,
};

export interface InsightsPageProps {
  /** From `loadEstate()`, in any order. */
  estate: readonly Pipeline[];
  /** When the data was read; ages and windows count back from it. */
  now: Date | number;
  /** Shown in the subtitle. */
  project: string;
  links: InsightsLinks;
  initialView?: Partial<InsightsView>;
  /**
   * Reads one run's stages, for the older runs `loadEstate()` left without them. The side panel
   * calls it when it opens. Without it the panel says which runs have stages.
   */
  loadStages?: (runId: number) => Promise<Stage[] | null>;
  /** True while the descriptions and lines are still being read, after the first paint. */
  readingMetadata?: boolean;
  /** True while a refresh is under way; the page keeps showing the data it has. */
  refreshing?: boolean;
  /** Called when the viewer picks a folder, so the host can put it in the page address. */
  onFolderChange?: (folder: string | null) => void;
  /** What the host read beside the pipelines, for the setup panel's checks. */
  setup?: SetupFacts;
  /** The viewer's choice to search whole repos for metadata files. Absent when the host cannot. */
  repoSearch?: RepoSearch;
  /** The setup panel's footer. */
  about?: About;
  /** How long the descriptions took to read after the runs, in milliseconds. */
  metadataMs?: number;
}

interface Tip {
  text: string;
  left: number;
  top: number;
}

/**
 * The Insights page: what needs attention, the estate's health, then one block per folder, with
 * a side panel per pipeline. Colours and fonts come from `--pi-*` variables the host sets.
 */
export function InsightsPage(props: InsightsPageProps) {
  const { estate, now: nowInput, project, links, initialView, loadStages, readingMetadata, refreshing, onFolderChange } = props;
  const now = +nowInput;
  const [view, setView] = useState<InsightsView>(() => ({
    ...DEFAULT_VIEW,
    ...initialView,
  }));
  const [selected, setSelected] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const update = (patch: Partial<InsightsView>) => setView((v) => ({ ...v, ...patch }));

  const { windowDays, mainOnly } = view;
  const options = useMemo(() => ({ windowDays, mainOnly, now }), [windowDays, mainOnly, now]);
  const { folder, repo, category, component } = view;
  const scope: Scope = useMemo(() => ({ folder, repo, category, component }), [folder, repo, category, component]);
  const inView = useMemo(() => estate.filter((p) => inScope(p, scope)), [estate, scope]);
  const summary = useMemo(() => summarizeEstate(inView, options), [inView, options]);
  // The no-owner count is setup, not something urgent, so the setup panel carries it.
  const attention = useMemo(() => summary.attention.filter((i): i is PipelineItem => i.kind !== 'noOwner'), [summary]);
  // Lines read only facts, so they appear once the metadata has loaded. They are inferred from
  // the whole estate, so a narrower view never changes which pipelines group.
  const lines = useMemo(() => inferLines(estate), [estate]);
  const linesInView = useMemo(() => scopeLines(lines, new Set(inView.map((p) => p.id)), estate), [lines, inView, estate]);
  const folders = useMemo(() => folderOptions(estate), [estate]);
  const filters = useMemo(() => quickFilters(estate, scope), [estate, scope]);
  const setup = useMemo(() => setupStatus(estate, lines, props.setup ?? {}), [estate, lines, props.setup]);
  const pickFolder = (f: string | null) => {
    update({ folder: f });
    onFolderChange?.(f);
  };
  const selectedPipeline = selected === null ? undefined : estate.find((p) => p.id === selected);
  const closePanel = useCallback(() => setSelected(null), []);

  const onMouseOver = (e: MouseEvent) => {
    const target = (e.target as Element).closest?.('[data-tip]');
    if (!target) return setTip(null);
    const r = target.getBoundingClientRect();
    setTip({
      text: target.getAttribute('data-tip') ?? '',
      left: Math.min(window.innerWidth - 290, Math.max(8, r.left - 10)),
      top: r.bottom + 6,
    });
  };

  return (
    <div className="pi-root" onMouseOver={onMouseOver} onMouseLeave={() => setTip(null)}>
      <style href="pipeline-insights" precedence="default">
        {styles}
      </style>
      <div className="pi-page">
        <main className="pi-main">
          <div className="pi-head">
            <div>
              <h1>
                {view.folder ? (
                  <button type="button" className="pi-crumb" onClick={() => pickFolder(null)}>
                    Pipeline Insights
                  </button>
                ) : (
                  'Pipeline Insights'
                )}
                <span className="pi-crumb-sep" aria-hidden="true">
                  ›
                </span>
                <FolderPicker options={folders} folder={view.folder} total={estate.length} onPick={pickFolder} />
              </h1>
              <div className="pi-sub">
                {project} · {inFolderText(summary.pipelines.length, view.folder, folders)} · data as of {asOf(now)}
                {refreshing && <span className="pi-ring" role="status" aria-label="Refreshing" />}
                {readingMetadata && (
                  <span className="pi-busy" role="status">
                    <i aria-hidden="true" />
                    reading descriptions and lines
                  </span>
                )}
              </div>
            </div>
            <div className="pi-controls">
              <div className="pi-seg" role="group" aria-label="Time window">
                {WINDOW_DAYS.map((d) => (
                  <button key={d} type="button" aria-pressed={view.windowDays === d} onClick={() => update({ windowDays: d })}>
                    {d} days
                  </button>
                ))}
              </div>
              <label className="pi-toggle">
                <input type="checkbox" checked={view.mainOnly} onChange={(e) => update({ mainOnly: e.target.checked })} /> main
                branch only
              </label>
              {filters.repo && <QuickFilter label="Repo" values={filters.repo} value={view.repo} onChange={(v) => update({ repo: v })} />}
              {filters.category && (
                <QuickFilter label="Category" values={filters.category} value={view.category} onChange={(v) => update({ category: v })} />
              )}
              {filters.component && (
                <QuickFilter label="Component" values={filters.component} value={view.component} onChange={(v) => update({ component: v })} />
              )}
              <input
                className="pi-search"
                type="search"
                placeholder="Filter pipelines"
                aria-label="Filter pipelines"
                value={view.query}
                onChange={(e) => update({ query: e.target.value })}
              />
            </div>
          </div>

          <div className="pi-top">
            <Attention
              items={attention}
              windowDays={view.windowDays}
              now={now}
              links={links}
              showAll={view.showAllAttention}
              onToggleShowAll={() => update({ showAllAttention: !view.showAllAttention })}
              onOpen={setSelected}
            />
            <EstateHealth
              summary={summary}
              windowDays={view.windowDays}
              filter={view.filter}
              onFilter={(s) => update({ filter: view.filter === s ? null : s })}
            />
          </div>

          <Folders
            pipelines={summary.pipelines}
            lines={linesInView}
            query={view.query}
            filter={view.filter}
            mainOnly={view.mainOnly}
            now={now}
            open={view.open}
            openLines={view.openLines}
            onToggleFolder={(folder, open) => update({ open: { ...view.open, [folder]: open } })}
            onToggleLine={(line, open) => update({ openLines: { ...view.openLines, [line]: open } })}
            onOpen={setSelected}
          />
        </main>
      </div>
      <SetupPanel status={setup} readingMetadata={readingMetadata} about={props.about} now={now} metadataMs={props.metadataMs} repoSearch={props.repoSearch} />
      {selectedPipeline && (
        <SidePanel
          a={pipelineState(selectedPipeline, options)}
          windowDays={view.windowDays}
          mainOnly={view.mainOnly}
          now={now}
          links={links}
          loadStages={loadStages}
          related={relatedFor(lines, estate, selectedPipeline.id)}
          onClose={closePanel}
        />
      )}
      {tip && (
        <div className="pi-tip" style={{ left: tip.left, top: tip.top }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** "30 pipelines", or with a folder picked "10 pipelines in client and its 2 subfolders". */
function inFolderText(count: number, folder: string | null, options: readonly { folder: string }[]): string {
  const pipelines = `${count} ${count === 1 ? 'pipeline' : 'pipelines'}`;
  if (!folder) return pipelines;
  const subfolders = options.filter((o) => o.folder.toLowerCase() !== folder.toLowerCase() && inFolder(o.folder, folder)).length;
  const under = subfolders ? ` and its ${subfolders === 1 ? 'subfolder' : `${subfolders} subfolders`}` : '';
  return `${pipelines} in ${folderTitle(folder)}${under}`;
}
