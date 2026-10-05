/**
 * Records a real project as a fixture: the same calls `loadEstate()` and `loadMetadata()` make,
 * trimmed, plus the build-validation policies and the capture time.
 *
 *   AZURE_DEVOPS_EXT_PAT=… npm run capture-fixture -- --org https://dev.azure.com/<org> --project <project>
 *       [--out fixtures/recorded/<project>-YYYY-MM-DD.json]
 *   AZURE_DEVOPS_EXT_PAT=… npm run capture-fixture -- --org … --project … --files-into <fixture>
 *       [--overlay <Repo>=<checkout>]...
 *
 * `--files-into` reads only the pipeline folders and files, and adds them to an existing fixture
 * without touching its runs, so its golden results stay comparable. `--overlay` replaces each
 * listed file with the copy in a local checkout's working tree, where it differs: that is how
 * drafted metadata that has not merged yet reaches a fixture. The fixture records each overlay.
 *
 * Use a read-only PAT. The output is that project's real data: pipeline names, YAML, branch names
 * and run history. It goes to `fixtures/recorded/`, which git ignores, and must never be committed
 * to a public repo. `tools/check-identifiers.mjs` reads it too, so a package built while it is
 * there is also checked against its names. The committed fixture is the synthetic `contoso.json`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  FixtureSource,
  loadEstate,
  loadMetadata,
  MemoryCache,
  RecordingSource,
  type Fixture,
  type FixtureFiles,
  type PipelineSource,
} from '../src/index.js';
import { PatSource } from './pat-source.js';

const { values } = parseArgs({
  options: {
    org: { type: 'string' },
    project: { type: 'string' },
    out: { type: 'string' },
    'files-into': { type: 'string' },
    overlay: { type: 'string', multiple: true },
  },
});
const ORG = values.org;
const PROJECT = values.project;
if (!ORG || !PROJECT) {
  console.error('Pass --org https://dev.azure.com/<org> and --project <project>.');
  process.exit(2);
}
const pat = process.env.AZURE_DEVOPS_EXT_PAT;
if (!pat) {
  console.error('AZURE_DEVOPS_EXT_PAT is not set.');
  process.exit(2);
}
const live = new PatSource(ORG, PROJECT, pat);

if (values['files-into']) {
  const out = resolve(values['files-into']);
  const fixture = JSON.parse(readFileSync(out, 'utf8')) as Fixture;
  const recorded = new FixtureSource(fixture);
  // Everything but the files replays from the fixture, so the files match its definitions.
  const hybrid: PipelineSource = {
    definitions: () => recorded.definitions(),
    runs: (ids, n) => recorded.runs(ids, n),
    timeline: (id) => recorded.timeline(id),
    buildValidationPolicies: () => recorded.buildValidationPolicies(),
    listFolder: (repo, folder, branch) => live.listFolder(repo, folder, branch),
    readFile: (repo, id) => live.readFile(repo, id),
  };
  const recorder = new RecordingSource(hybrid);
  await loadMetadata(recorder, new MemoryCache());
  const files = recorder.fixture({ capturedAt: fixture.capturedAt, org: ORG, project: PROJECT }).files;
  if (!files) throw new Error('No pipeline folder could be read.');
  for (const spec of values.overlay ?? []) overlay(files, fixture, spec);
  save(out, { ...fixture, files });
} else {
  const recorder = new RecordingSource(live);
  const estate = await loadEstate(recorder, new MemoryCache());
  await loadMetadata(recorder, new MemoryCache(), estate);
  // Taken after the fetches, so no recorded run is queued after "now".
  const capturedAt = new Date().toISOString();
  const out = resolve(values.out ?? `fixtures/recorded/${PROJECT.toLowerCase()}-${capturedAt.slice(0, 10)}.json`);
  const fixture = recorder.fixture({ capturedAt, org: ORG, project: PROJECT });
  for (const spec of values.overlay ?? []) overlay(fixture.files!, fixture, spec);
  save(out, fixture);
}

/** Replaces the files a load read from one repo with their working-tree copies, where they differ. */
function overlay(files: FixtureFiles, fixture: Fixture, spec: string): void {
  const [repoName, dir] = spec.split('=');
  if (!repoName || !dir || !existsSync(dir)) throw new Error(`--overlay ${spec}: expected <Repo>=<checkout>`);
  const repoIds = new Set(fixture.definitions.filter((d) => d.repository?.name === repoName).map((d) => d.repository?.id));
  const branch = execFileSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  let changed = 0;
  for (const [key, listing] of Object.entries(files.listings)) {
    if (!repoIds.has(key.split(':')[0])) continue;
    for (const entry of listing) {
      // Only the files a load read: each pipeline's YAML and each repo's metadata file.
      const local = join(dir, entry.path);
      if (files.blobs[entry.objectId] === undefined || !existsSync(local)) continue;
      const text = readFileSync(local, 'utf8');
      const id = blobId(text);
      if (id === entry.objectId) continue;
      entry.objectId = id;
      files.blobs[id] = text;
      changed++;
    }
  }
  files.overlays = [...(files.overlays ?? []), `${repoName}: ${changed} files from a working tree on branch ${branch || '(detached)'}`];
  console.log(`overlay ${repoName}: ${changed} files`);
}

/** The git object id of a blob with this text: what Azure DevOps lists for the file. */
function blobId(text: string): string {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

function save(out: string, fixture: Fixture): void {
  if (fixture.files) {
    // Keep only the text some listing still points at.
    const used = new Set(Object.values(fixture.files.listings).flatMap((l) => l.map((e) => e.objectId)));
    fixture.files.blobs = Object.fromEntries(Object.entries(fixture.files.blobs).filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b)));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(fixture, null, 1)}\n`);
  const runs = fixture.runs.length;
  console.log(
    `${out}: ${fixture.definitions.length} pipelines, ${runs} runs, ${Object.keys(fixture.timelines).length} timelines, ` +
      `${fixture.buildValidationPolicies?.length ?? 'no'} policies, ` +
      `${fixture.files ? `${Object.keys(fixture.files.listings).length} folders, ${Object.keys(fixture.files.blobs).length} files` : 'no files'}`,
  );
}
