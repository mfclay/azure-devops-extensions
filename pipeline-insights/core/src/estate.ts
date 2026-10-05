import {
  CATALOG_FOLDERS,
  CATALOG_NAME,
  catalogKey,
  parseCatalog,
  resolveMetadata,
  type CatalogEntry,
  type MetadataSource,
} from './metadata.js';
import type { Cache, Definition, FileEntry, PipelineSource, Run, Timeline } from './source.js';
import { parseTriggers } from './triggers.js';

/** One stage of a run, in timeline order. */
export interface Stage {
  name: string;
  /** `pending`, `inProgress` or `completed`. */
  state: string | null;
  result: string | null;
  /** An approval check on this stage is open. A run paused here still reports `inProgress`. */
  waitingForApproval: boolean;
}

export interface PipelineRun {
  id: number;
  number: string;
  status: string;
  result: string | null;
  reason: string | null;
  /** Without `refs/heads/`. */
  branch: string;
  queued: string;
  started: string | null;
  finished: string | null;
  commit: string;
  /**
   * Null when the timeline was not fetched. Timelines are fetched only for each pipeline's
   * newest run and for every unfinished run, so an older finished run has none.
   */
  stages: Stage[] | null;
}

/**
 * What the YAML and the pipeline's documentation say, as opposed to what Azure DevOps reports.
 * `loadMetadata()` reads them, through `parseTriggers()` and `resolveMetadata()`, after the run
 * status has painted. An absent fact reads as "no": not manual-only, no owner.
 */
export interface PipelineFacts {
  /** The YAML has no CI, PR, schedule or resource trigger. */
  manualOnly?: boolean;
  /** The pipeline whose completion triggers this one: the first, when several do. */
  runsAfter?: string;
  /** Every pipeline whose completion triggers this one. `inferLines()` follows them all. */
  runsAfterAll?: string[];
  /** The CI trigger's path includes. `inferLines()` reads component folders from them. */
  ciPaths?: string[];
  /** Other repos whose pushes start this one. Shown as a note, never used for grouping. */
  otherRepos?: string[];
  owner?: string;
  /** One or two sentences on what the pipeline is for. */
  purpose?: string;
  /** Where the purpose came from; `derived` and `structural` are guesses, shown as such. */
  purposeSource?: MetadataSource;
  /** The purpose was drafted and is marked `(TODO: verify)` in its file. */
  draft?: boolean;
  category?: string;
  component?: string;
  /** An entry's Markdown after its purpose, such as a runbook. */
  details?: string;
  /** Its entry says `archived: true`. See `isRetired()`. */
  archived?: boolean;
  /** The repo's metadata file, by path from the repo root. Absent when the repo has none. */
  metadataFile?: string;
  /**
   * Where the repo's metadata file should be created, when it has none: the first well-known
   * folder that exists, `` for the root.
   */
  metadataFolder?: string;
  /** The metadata file has an entry for this pipeline, with or without a purpose. */
  described?: boolean;
  /** What to fix in the pipeline's entry, as sentences. */
  metadataProblems?: string[];
  /** One line per trigger, for display. Backticks mark names, branches and paths. */
  triggers?: string[];
  /**
   * A YAML pipeline whose file could not be read on its default branch. `missing`: the folder was
   * listed and the file is not in it, so the pipeline cannot run. `unreadable`: the folder or file
   * could not be read, which Azure DevOps reports the same way for a deleted repo and one the
   * viewer cannot open. Absent when the YAML was read, and for a classic pipeline, which has none.
   */
  yaml?: { state: 'missing' | 'unreadable'; branch: string };
}

export interface Pipeline {
  id: number;
  name: string;
  folder: string;
  repo: string;
  yamlPath: string;
  disabled: boolean;
  /** Newest first, by queue time. */
  runs: PipelineRun[];
  facts: PipelineFacts;
}

export interface LoadOptions {
  /** How many runs to fetch per pipeline. Defaults to 15. */
  runsPerDefinition?: number;
  /** How many timelines to fetch at once. Defaults to 8. */
  concurrency?: number;
  /** Facts by definition id. */
  facts?: Readonly<Record<number, PipelineFacts>>;
  /** Called as the load goes, so a host can show how far it has got. */
  onProgress?: (progress: LoadProgress) => void;
}

/**
 * How far `loadEstate` has got. A pipeline is ready once every timeline it needs has been read;
 * one with no runs is ready as soon as the runs are.
 */
export interface LoadProgress {
  pipelines: number;
  ready: number;
}

const APPROVAL = 'Checkpoint.Approval';

/**
 * A run's stages from its timeline. A stage waits for approval when an open
 * `Checkpoint.Approval` record hangs off the stage itself or one of its direct children.
 */
export function stagesFromTimeline(timeline: Timeline): Stage[] {
  const records = timeline.records;
  return records
    .filter((r) => r.type === 'Stage')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((stage) => {
      const parents = new Set([stage.id, ...records.filter((r) => r.parentId === stage.id).map((r) => r.id)]);
      return {
        name: stage.name ?? '',
        state: stage.state ?? null,
        result: stage.result ?? null,
        waitingForApproval: records.some(
          (r) => r.type === APPROVAL && r.state === 'inProgress' && r.parentId != null && parents.has(r.parentId),
        ),
      };
    });
}

/**
 * Every pipeline with its runs and the timelines the rules need, in the order the source
 * lists definitions. Timelines of finished runs come from the cache once seen.
 */
export async function loadEstate(source: PipelineSource, cache: Cache, options: LoadOptions = {}): Promise<Pipeline[]> {
  const definitions = await source.definitions();
  const report = (ready: number) => options.onProgress?.({ pipelines: definitions.length, ready });
  report(0);
  const runs = await source.runs(definitions.map((d) => d.id), options.runsPerDefinition ?? 15);

  const byDefinition = new Map<number, Run[]>();
  for (const run of runs) {
    const list = byDefinition.get(run.definition.id);
    if (list) list.push(run);
    else byDefinition.set(run.definition.id, [run]);
  }

  const wanted = new Set<number>();
  for (const list of byDefinition.values()) if (list[0]) wanted.add(list[0].id);
  for (const run of runs) if (run.status !== 'completed') wanted.add(run.id);

  // Timelines still to read, by definition, so progress can count whole pipelines.
  const owner = new Map(runs.map((r) => [r.id, r.definition.id]));
  const outstanding = new Map<number, number>();
  for (const id of wanted) outstanding.set(owner.get(id)!, (outstanding.get(owner.get(id)!) ?? 0) + 1);
  let ready = definitions.filter((d) => !outstanding.has(d.id)).length;
  report(ready);

  const finished = new Set(runs.filter((r) => r.status === 'completed').map((r) => r.id));
  const stages = new Map<number, Stage[] | null>();
  await forEachLimited([...wanted], options.concurrency ?? 8, async (id) => {
    stages.set(id, await loadRunStages(source, cache, id, finished.has(id)));
    const definition = owner.get(id)!;
    const left = outstanding.get(definition)! - 1;
    outstanding.set(definition, left);
    if (left === 0) report(++ready);
  });

  return definitions.map((d) => toPipeline(d, byDefinition.get(d.id) ?? [], stages, options.facts?.[d.id] ?? {}));
}

/**
 * One run's stages, or null when its timeline cannot be read. A finished run's stages are cached,
 * since they never change. `loadEstate` uses this for the runs it needs; a host uses it for an
 * older run whose stages `loadEstate` left out.
 */
export async function loadRunStages(source: PipelineSource, cache: Cache, runId: number, finished: boolean): Promise<Stage[] | null> {
  const key = `timeline:${runId}`;
  if (finished) {
    const hit = await cache.get<Stage[]>(key);
    if (hit) return hit;
  }
  let timeline: Timeline;
  try {
    timeline = await source.timeline(runId);
  } catch {
    return null;
  }
  const result = stagesFromTimeline(timeline);
  if (finished) await cache.set(key, result);
  return result;
}

function toPipeline(d: Definition, runs: Run[], stages: Map<number, Stage[] | null>, facts: PipelineFacts): Pipeline {
  return {
    id: d.id,
    name: d.name,
    folder: d.path || '\\',
    repo: d.repository?.name ?? '',
    yamlPath: (d.process?.yamlFilename ?? '').replace(/^\/+/, ''),
    disabled: d.queueStatus === 'disabled',
    runs: runs.map((r) => ({
      id: r.id,
      number: r.buildNumber ?? '',
      status: r.status,
      result: r.result ?? null,
      reason: r.reason ?? null,
      branch: (r.sourceBranch ?? '').replace(/^refs\/heads\//, ''),
      queued: r.queueTime,
      started: r.startTime ?? null,
      finished: r.finishTime ?? null,
      commit: (r.sourceVersion ?? '').slice(0, 8),
      stages: stages.get(r.id) ?? null,
    })),
    facts,
  };
}

/** A repo's metadata file, as `loadMetadata` found it. One per repo that holds a pipeline's YAML. */
export interface RepoCatalog {
  repo: string;
  /** The file used, by path from the repo root; null when none was found. */
  path: string | null;
  /** `search`: found only by searching the whole repo, outside the well-known folders. */
  foundBy?: 'well-known' | 'search';
  /** Problems with the file as a whole, or with finding it, as sentences. */
  problems: string[];
  /** YAML paths the file describes that no pipeline in this project uses. */
  orphans: string[];
  /** False when not one of the repo's folders could be listed: a deleted repo, or no access. */
  readable: boolean;
}

/** What `loadMetadata` read: facts by definition id, and each repo's metadata file. */
export interface EstateMetadata {
  facts: Record<number, PipelineFacts>;
  /** Sorted by repo name. */
  catalogs: RepoCatalog[];
  /** False when the branch policies could not be read, so no PR trigger lines are shown. */
  policiesRead: boolean;
  /** Whether repos with no metadata file in a well-known folder were searched whole. */
  searched: boolean;
}

export interface MetadataOptions extends Pick<LoadOptions, 'concurrency'> {
  /**
   * Search the whole repo for its metadata file when none is in a well-known folder. Off by
   * default: it lists every file in the repo. Ignored when the source has no `listAll`.
   */
  searchRepos?: boolean;
}

/**
 * Every pipeline's triggers and documentation, read from its YAML, its repo's metadata file and
 * the branch policies. Each pipeline folder and each well-known folder is listed once, which
 * gives every file's git object id, and a file is fetched only when its id is not in the cache.
 * Hosts call this after the run status has painted, since it never changes what needs attention
 * now. `estate` supplies the newest run's stages for a pipeline nobody has described.
 */
export async function loadMetadata(
  source: PipelineSource,
  cache: Cache,
  estate: readonly Pipeline[] = [],
  options: MetadataOptions = {},
): Promise<EstateMetadata> {
  const limit = options.concurrency ?? 8;
  const search = Boolean(options.searchRepos && source.listAll);
  const [definitions, policies] = await Promise.all([
    source.definitions(),
    source.buildValidationPolicies().catch(() => null),
  ]);

  const places = definitions.map((d) => {
    const yamlPath = (d.process?.yamlFilename ?? '').replace(/^\/+/, '');
    const slash = yamlPath.lastIndexOf('/');
    return {
      d,
      repoId: d.repository?.id ?? '',
      repo: d.repository?.name ?? d.repository?.id ?? '',
      branch: (d.repository?.defaultBranch ?? 'refs/heads/main').replace(/^refs\/heads\//, ''),
      yamlPath,
      folder: slash < 0 ? '' : yamlPath.slice(0, slash),
    };
  });
  type Place = (typeof places)[number];
  const key = (repoId: string, branch: string, folder: string) => `${repoId}:${branch}:${folder}`;
  const described = places.filter((p) => p.repoId && p.yamlPath);

  // Every pipeline folder, and each repo's well-known folders, listed once.
  const repos = [...new Map(described.map((p) => [`${p.repoId}:${p.branch}`, p])).values()];
  const folders = new Map<string, { repoId: string; branch: string; folder: string }>();
  for (const p of described) folders.set(key(p.repoId, p.branch, p.folder), p);
  for (const r of repos) {
    for (const folder of CATALOG_FOLDERS) folders.set(key(r.repoId, r.branch, folder), { ...r, folder });
  }
  const listings = new Map<string, FileEntry[] | null>();
  await forEachLimited([...folders], limit, async ([k, f]) => {
    listings.set(k, await source.listFolder(f.repoId, f.folder, f.branch).catch(() => null));
  });

  /** A file's text; or why there is none: not in a listing that was read, or not readable. */
  type Read = { text: string } | { text: null; why: 'missing' | 'unreadable' };
  const readEntry = async (repoId: string, entry: FileEntry): Promise<Read> => {
    const cacheKey = `file:${entry.objectId}`;
    const hit = await cache.get<string>(cacheKey);
    if (hit !== undefined) return { text: hit };
    try {
      const text = await source.readFile(repoId, entry.objectId);
      await cache.set(cacheKey, text);
      return { text };
    } catch {
      return { text: null, why: 'unreadable' };
    }
  };
  const read = async (repoId: string, listing: FileEntry[] | null | undefined, path: string): Promise<Read> => {
    if (!listing) return { text: null, why: 'unreadable' };
    const entry = findFile(listing, path);
    return entry ? readEntry(repoId, entry) : { text: null, why: 'missing' };
  };

  // Each repo's metadata file: the first well-known folder that holds one, else a search if asked.
  type Found = { catalog: RepoCatalog; entries: Map<string, CatalogEntry>; folder?: string };
  const found = new Map<string, Found>();
  await forEachLimited(repos, limit, async (r: Place) => {
    const catalog: RepoCatalog = { repo: r.repo, path: null, problems: [], orphans: [], readable: false };
    const hits: FileEntry[] = [];
    for (const folder of CATALOG_FOLDERS) {
      const listing = listings.get(key(r.repoId, r.branch, folder));
      if (listing) catalog.readable = true;
      const hit = listing && findFile(listing, folder ? `${folder}/${CATALOG_NAME}` : CATALOG_NAME);
      if (hit) hits.push(hit);
    }
    // A repo whose pipeline folders could be listed is readable, even with no well-known folder.
    catalog.readable ||= described.some((p) => p.repoId === r.repoId && listings.get(key(r.repoId, r.branch, p.folder)));
    if (!hits.length && search && catalog.readable) {
      const all = await source.listAll!(r.repoId, r.branch).catch(() => null);
      if (!all) catalog.problems.push('The repo could not be searched for its metadata file.');
      const matches = (all ?? [])
        .filter((e) => e.gitObjectType !== 'tree' && e.path.split('/').pop()!.toLowerCase() === CATALOG_NAME)
        .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
      hits.push(...matches);
      if (matches.length) catalog.foundBy = 'search';
    }
    const [used, ...others] = hits;
    let entries = new Map<string, CatalogEntry>();
    if (used) {
      catalog.path = used.path.replace(/^\//, '');
      catalog.foundBy ??= 'well-known';
      if (others.length) {
        catalog.problems.push(`Also found at ${others.map((o) => o.path.replace(/^\//, '')).join(', ')}, which ${others.length === 1 ? 'is' : 'are'} ignored. Keep one.`);
      }
      const text = await readEntry(r.repoId, used);
      if (text.text === null) catalog.problems.push('The file could not be read.');
      else {
        const parsed = parseCatalog(text.text);
        catalog.problems.push(...parsed.problems);
        entries = parsed.entries;
      }
    }
    const folder = CATALOG_FOLDERS.find((f) => listings.get(key(r.repoId, r.branch, f)));
    found.set(`${r.repoId}:${r.branch}`, { catalog, entries, ...(folder !== undefined && { folder }) });
  });

  const UNKNOWN = { missing: (branch: string) => `Unknown: the YAML is not on \`${branch}\``, unreadable: () => 'Unknown: the YAML could not be read' };
  const stagesById = new Map(estate.map((p) => [p.id, (p.runs[0]?.stages ?? []).map((s) => s.name)]));
  const facts: Record<number, PipelineFacts> = {};
  const used = new Set<string>();
  await forEachLimited(places, limit, async (p) => {
    const yamlRead = p.yamlPath ? await read(p.repoId, listings.get(key(p.repoId, p.branch, p.folder)), p.yamlPath) : null;
    const yaml = yamlRead?.text ?? null;
    const repoCatalog = p.yamlPath ? found.get(`${p.repoId}:${p.branch}`) : undefined;
    const entry = repoCatalog?.entries.get(catalogKey(p.yamlPath)) ?? null;
    if (entry) used.add(`${p.repoId}:${p.branch}:${catalogKey(p.yamlPath)}`);
    const triggers = parseTriggers(yaml, p.d, policies);
    const yamlState = yamlRead && yamlRead.text === null ? yamlRead.why : null;
    // Triggers set in the UI are still known without the YAML; only the bare fallback is replaced.
    if (yamlState && triggers.lines.length === 1 && triggers.lines[0]!.startsWith('Unknown')) {
      triggers.lines = [UNKNOWN[yamlState](p.branch)];
    }
    const m = resolveMetadata(yaml, entry, { runsAfter: triggers.runsAfter, stages: stagesById.get(p.d.id) ?? [] });
    const f: PipelineFacts = { triggers: triggers.lines, purposeSource: m.source };
    if (triggers.manualOnly) f.manualOnly = true;
    if (triggers.runsAfter[0]) {
      f.runsAfter = triggers.runsAfter[0];
      f.runsAfterAll = triggers.runsAfter;
    }
    if (triggers.ciPaths.length) f.ciPaths = triggers.ciPaths;
    if (triggers.otherRepos.length) f.otherRepos = triggers.otherRepos;
    if (m.purpose) f.purpose = m.purpose;
    if (m.draft) f.draft = true;
    if (m.owner) f.owner = m.owner;
    if (m.category) f.category = m.category;
    if (m.component) f.component = m.component;
    if (m.details) f.details = m.details;
    if (m.archived) f.archived = true;
    if (yamlState) f.yaml = { state: yamlState, branch: p.branch };
    if (repoCatalog?.catalog.path) f.metadataFile = repoCatalog.catalog.path;
    else if (repoCatalog?.folder !== undefined && yaml !== null) f.metadataFolder = repoCatalog.folder;
    if (entry) f.described = true;
    if (m.problems.length) f.metadataProblems = m.problems;
    facts[p.d.id] = f;
  });

  for (const [repoKey, { catalog, entries }] of found) {
    for (const [k, entry] of entries) if (!used.has(`${repoKey}:${k}`)) catalog.orphans.push(entry.path);
  }
  const catalogs = [...found.values()].map((f) => f.catalog).sort((a, b) => a.repo.localeCompare(b.repo));
  return { facts, catalogs, policiesRead: policies !== null, searched: search };
}

function findFile(listing: readonly FileEntry[], path: string): FileEntry | undefined {
  const wanted = `/${path}`.toLowerCase();
  return listing.find((e) => e.gitObjectType !== 'tree' && e.path.toLowerCase() === wanted);
}

/** The estate with each pipeline's facts replaced by the ones `loadMetadata` read. */
export function withFacts(estate: readonly Pipeline[], facts: Readonly<Record<number, PipelineFacts>>): Pipeline[] {
  return estate.map((p) => (facts[p.id] ? { ...p, facts: facts[p.id]! } : p));
}

async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
