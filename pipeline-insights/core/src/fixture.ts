import type { BuildPolicy, Definition, FileEntry, PipelineSource, Run, Timeline } from './source.js';

/**
 * A recorded estate: every response a load fetched, already trimmed, plus when it was taken.
 * `capture-fixture` writes one; `FixtureSource` replays it through the same interface the
 * extension's live source implements.
 *
 * The committed fixture, `fixtures/contoso.json`, is synthetic. A recording of a real project is
 * that project's data: keep it out of the repo. Only tests and the dev page may import a
 * fixture, never anything an extension's entry point reaches.
 */
export interface Fixture {
  format: 1;
  /** ISO time the capture finished. Tests pin `now` to it. */
  capturedAt: string;
  org: string;
  project: string;
  definitions: Definition[];
  /** Queue time, newest first, as `runs()` returned them. */
  runs: Run[];
  /** Keyed by run id. */
  timelines: Record<string, Timeline>;
  /** Null when the capturing token could not read policies. */
  buildValidationPolicies: BuildPolicy[] | null;
  /** The pipeline folders and the YAML and sidecars in them. Absent from a fixture taken before M4. */
  files?: FixtureFiles;
}

export interface FixtureFiles {
  /** Folder listings by `listingKey()`. A folder that could not be read is absent. */
  listings: Record<string, FileEntry[]>;
  /** File text by git object id. */
  blobs: Record<string, string>;
  /** Where the files differ from what the branch held, such as drafted headers taken from a working tree. */
  overlays?: string[];
}

export function listingKey(repoId: string, folder: string, branch: string): string {
  return `${repoId}:${branch}:${folder}`;
}

export class FixtureSource implements PipelineSource {
  constructor(readonly fixture: Fixture) {}

  async definitions(): Promise<Definition[]> {
    return this.fixture.definitions;
  }

  async runs(ids: number[], perDefinition: number): Promise<Run[]> {
    const wanted = new Set(ids);
    const counts = new Map<number, number>();
    return this.fixture.runs.filter((run) => {
      const id = run.definition.id;
      const seen = counts.get(id) ?? 0;
      if (!wanted.has(id) || seen >= perDefinition) return false;
      counts.set(id, seen + 1);
      return true;
    });
  }

  async timeline(runId: number): Promise<Timeline> {
    const timeline = this.fixture.timelines[runId];
    if (!timeline) throw new Error(`run ${runId} has no timeline in the fixture`);
    return timeline;
  }

  async buildValidationPolicies(): Promise<BuildPolicy[]> {
    if (!this.fixture.buildValidationPolicies) throw new Error('the fixture has no policies');
    return this.fixture.buildValidationPolicies;
  }

  async listFolder(repoId: string, folder: string, branch: string): Promise<FileEntry[]> {
    const listing = this.fixture.files?.listings[listingKey(repoId, folder, branch)];
    if (!listing) throw new Error(`the fixture has no listing of ${folder || '/'} on ${branch}`);
    return listing;
  }

  async readFile(_repoId: string, objectId: string): Promise<string> {
    const text = this.fixture.files?.blobs[objectId];
    if (text === undefined) throw new Error(`the fixture has no file ${objectId}`);
    return text;
  }
}

/** Wraps a source and keeps every response it returns, to save as a `Fixture`. */
export class RecordingSource implements PipelineSource {
  #definitions: Definition[] = [];
  #runs: Run[] = [];
  readonly #timelines: Record<string, Timeline> = {};
  #policies: BuildPolicy[] | null = null;
  readonly #listings: Record<string, FileEntry[]> = {};
  readonly #blobs: Record<string, string> = {};

  constructor(readonly inner: PipelineSource) {}

  async definitions(): Promise<Definition[]> {
    return (this.#definitions = await this.inner.definitions());
  }

  async runs(ids: number[], perDefinition: number): Promise<Run[]> {
    return (this.#runs = await this.inner.runs(ids, perDefinition));
  }

  async timeline(runId: number): Promise<Timeline> {
    return (this.#timelines[runId] = await this.inner.timeline(runId));
  }

  async buildValidationPolicies(): Promise<BuildPolicy[]> {
    return (this.#policies = await this.inner.buildValidationPolicies());
  }

  async listFolder(repoId: string, folder: string, branch: string): Promise<FileEntry[]> {
    return (this.#listings[listingKey(repoId, folder, branch)] = await this.inner.listFolder(repoId, folder, branch));
  }

  async readFile(repoId: string, objectId: string): Promise<string> {
    return (this.#blobs[objectId] = await this.inner.readFile(repoId, objectId));
  }

  fixture(meta: Pick<Fixture, 'capturedAt' | 'org' | 'project'>): Fixture {
    const timelines = Object.fromEntries(
      Object.entries(this.#timelines).sort(([a], [b]) => Number(a) - Number(b)),
    );
    return {
      format: 1,
      ...meta,
      definitions: this.#definitions,
      runs: this.#runs,
      timelines,
      buildValidationPolicies: this.#policies,
      ...(Object.keys(this.#listings).length ? { files: { listings: sortKeys(this.#listings), blobs: sortKeys(this.#blobs) } } : {}),
    };
  }
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
