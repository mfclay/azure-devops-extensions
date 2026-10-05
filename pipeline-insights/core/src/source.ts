/**
 * What a host fetches from Azure DevOps, and the two things it injects into core.
 *
 * Every type here is a raw REST response trimmed to the fields core reads: fields are picked,
 * never renamed or reshaped, so a trimmed object is always a subset of what the API returned.
 * The trim functions in `trim.ts` do the picking for every source.
 */

/** `build/definitions?includeAllProperties=true`. */
export interface Definition {
  id: number;
  name: string;
  /** The folder, such as `\tools`; `\` for the root. */
  path?: string;
  /** `enabled`, `paused` or `disabled`. */
  queueStatus?: string;
  /** `type` 2 is YAML; classic pipelines have no `yamlFilename`. */
  process?: { type?: number; yamlFilename?: string };
  repository?: { id?: string; name?: string; type?: string; defaultBranch?: string };
  /**
   * Only triggers set in the pipeline settings carry anything here. Every YAML pipeline gets
   * the same stub (`settingsSourceType` 2), so real trigger facts come from the YAML at M4.
   */
  triggers?: unknown[];
}

/** `build/builds`, always fetched with `queryOrder=queueTimeDescending`. */
export interface Run {
  id: number;
  buildNumber?: string;
  definition: { id: number };
  /** `completed` once finished; a run paused at an approval is still `inProgress`. */
  status: string;
  /** `succeeded`, `partiallySucceeded`, `failed` or `canceled`; absent until finished. */
  result?: string;
  reason?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  queueTime: string;
  startTime?: string;
  finishTime?: string;
}

/** `build/builds/{id}/timeline`, trimmed to stages, their children and approvals. */
export interface Timeline {
  records: TimelineRecord[];
}

export interface TimelineRecord {
  id: string;
  parentId?: string | null;
  /** `Stage`, `Checkpoint.Approval`, or a stage's direct child, which an approval hangs off. */
  type: string;
  name?: string;
  state?: string | null;
  result?: string | null;
  order?: number | null;
}

/** A build-validation branch policy, from `policy/configurations`. Read by `parseTriggers` at M4. */
export interface BuildPolicy {
  id: number;
  isEnabled?: boolean;
  isBlocking?: boolean;
  isDeleted?: boolean;
  settings: {
    buildDefinitionId?: number;
    displayName?: string | null;
    filenamePatterns?: string[];
    scope?: { repositoryId?: string | null; refName?: string; matchKind?: string }[];
  };
}

/** One entry of a listing: `git/repositories/{id}/items` with `recursionLevel` `OneLevel` or `Full`. */
export interface FileEntry {
  /** From the repo root, with a leading `/`: `/pipelines/orders-app-build.yaml`. */
  path: string;
  /** The git object id, which changes exactly when the content does. */
  objectId: string;
  /** `blob` for a file, `tree` for a folder. */
  gitObjectType?: string;
}

/**
 * Fetches. Each host supplies its own: the extension calls Azure DevOps with the viewer's
 * token, the dev page replays a fixture, `capture-fixture` uses a PAT.
 */
export interface PipelineSource {
  definitions(): Promise<Definition[]>;
  /**
   * The newest `perDefinition` runs of each definition, ordered by queue time, newest first.
   * Never order by finish time: that silently drops unfinished runs, so a pipeline waiting
   * at an approval looks idle.
   */
  runs(ids: number[], perDefinition: number): Promise<Run[]>;
  timeline(runId: number): Promise<Timeline>;
  /** May reject, for a token without policy read; PR trigger lines are dropped if it does. */
  buildValidationPolicies(): Promise<BuildPolicy[]>;
  /**
   * The files and folders directly in `folder` (`pipelines`, or `` for the root) on `branch`
   * (`main`, not `refs/heads/main`). Rejects when the repo or folder cannot be read.
   */
  listFolder(repoId: string, folder: string, branch: string): Promise<FileEntry[]>;
  /**
   * Every file and folder in the repo on `branch`, for the viewer who asks Insights to search a
   * whole repo for its metadata file. Optional: a host without it never offers that search.
   */
  listAll?(repoId: string, branch: string): Promise<FileEntry[]>;
  /** A file's text by git object id, so a cached copy is never stale. */
  readFile(repoId: string, objectId: string): Promise<string>;
}

/** Remembers. Keyed by git object id or run id, so a hit never goes stale. */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

/** A `Cache` that lasts as long as the object. Tests, the dev page and `capture-fixture` use it. */
export class MemoryCache implements Cache {
  readonly #entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.#entries.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.#entries.set(key, value);
  }
}
