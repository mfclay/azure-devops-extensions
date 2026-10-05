# Pipeline Insights: build-out plan

Last revised 2026-10-05. This file is the source of truth for the build; the design is
[design.md](design.md).

How Pipeline Insights gets built: the package layout, the interfaces between packages, publishing, and the order of work.

## Layout

One npm workspace with four packages, and the project's tools beside them.

```text
pipeline-insights/
  package.json              npm workspaces: core, ui, dev, extension
  tsconfig.base.json
  Taskfile.yml              task pre-commit: typecheck + test + denylist check
  docs/                     this plan and the design
  tools/
    tfx-run                 tfx wrapper: Marketplace URL, PAT from the environment, redacted output
    check-identifiers.mjs   fails if fixture data or real identifiers reach a staged package (M3)
    check-denylist.mjs      fails if any file matches the private denylist
    denylist.mjs            finds and reads that denylist
  core/                     rules and parsing; no network, no ADO SDK
    fixtures/               the synthetic contoso estate, its generator, and the goldens
  ui/                       React components; themed by the host
  extension/                manifest, hub entry point, ADO data source, packaging
    overrides/
      release.example.json  placeholder for the release publisher
  dev/                      local dev page: ui + core on fixture data
```

| Package | Holds | Depends on | In the VSIX |
| --- | --- | --- | --- |
| core | Types, state model, attention rules, metadata reader, line inference; fixtures for tests and the dev page | A YAML parser only | Yes, bundled; fixtures are not |
| ui | The Insights page as React components; CSS variables for the theme | core | Yes, bundled |
| extension | `vss-extension.json`, the hub's entry point, the data source that calls ADO with the SDK token, `scripts/package.mjs` | core, ui, `azure-devops-extension-sdk` | It is the VSIX |
| dev | A Vite page that renders ui from a fixture data source | core, ui | No |

Packaging refuses to run without an overrides file, so a publisher never comes from the manifest by default.

## At a glance

```text
  +----------------------+   +----------------------+
  | extension            |   | dev                  |
  | Azure DevOps hub,    |   | Local Vite page      |
  |   the VSIX           |   | FixtureSource:       |
  | ADO source: the      |   |   the contoso estate |
  |   viewer's token     |   |                      |
  +----------+-----------+   +----------+-----------+
             |                          |
             v                          v
  +---------------------------------------------------------+
  | ui     React components, themed through --pi-* CSS vars |
  +----------------------------+----------------------------+
                               |
                               v
  +---------------------------------------------------------+
  | core   State model, attention rules, metadata reader,   |
  |        line inference. Defines PipelineSource and Cache;|
  |        each host supplies its own                       |
  +---------------------------------------------------------+
```

Arrows point from a package to what it imports. Each host hands core its own `PipelineSource` and `Cache`.

## Interfaces

Each host injects two things into core: a `PipelineSource` that fetches, and a `Cache` that remembers. Everything else is a pure function over what they return, so the same rules run in the extension and the dev page.

```ts
// Raw ADO data, trimmed to what the rules read: fields are picked, never renamed (core/src/trim.ts).
interface PipelineSource {
  definitions(): Promise<Definition[]>;                 // build/definitions?includeAllProperties=true
  runs(ids: number[], perDefinition: number): Promise<Run[]>;  // queryOrder=queueTimeDescending, always
  timeline(runId: number): Promise<Timeline>;           // stages, their direct children, approvals
  buildValidationPolicies(): Promise<BuildPolicy[]>;    // may reject; PR lines are dropped if it does
  listFolder(repoId: string, folder: string, branch: string): Promise<FileEntry[]>;  // git items, one level: path + objectId
  listAll?(repoId: string, branch: string): Promise<FileEntry[]>;                    // optional: a whole repo, for the metadata search
  readFile(repoId: string, objectId: string): Promise<string>;                       // git blobs, $format=text
}

interface Cache {                                       // keyed by git object id or run id
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
```

| Function in core | Returns | Comes from |
| --- | --- | --- |
| `loadEstate(source, cache, options)` | Every pipeline with its runs and timelines; 8 calls at a time; finished runs from the cache; facts from options | M1 |
| `loadMetadata(source, cache, estate, options)` | Facts by pipeline, each repo's metadata file (where found, its problems, entries no pipeline uses), and whether the policies were readable. Lists each pipeline folder and each repo's well-known folders once, searches a whole repo only when `searchRepos` is set and the source has `listAll`, and reads a file only when its object id is not cached. Hosts call it after the first paint, then `withFacts(estate, facts)` | M4; the metadata file 2026-10-04 |
| `parseCatalog(text)` | A `pipelines.meta.yaml`'s entries by YAML path, each with its fields, details and problems, plus the file's own problems | 2026-10-04 |
| `resolveMetadata(yaml, entry, structure)` | The winning source (catalog, derived, structural, none), its fields, the draft mark, and the entry's problems | M4 |
| `parseTriggers(yaml, definition, policies)` | Trigger lines, manual-only, runs-after names and CI path includes, from the YAML, the pipeline settings and the build-validation policies | M4 |
| `pipelineState(pipeline, options)` | One of the nine states, plus window stats | The mockup's `analyse()`; M1 |
| `attention(estate, options)` | Attention items, priority then oldest first; structured fields, no sentences | The mockup's `attention()`; M1 |
| `explainItem(item, options)` | An item's sentence, with stage names marked for emphasis | The mockup's `why` text; M2 |
| `summarizeEstate(estate, options)` | The pipelines in view with their states, counts per state, window totals, waiting runs, attention items | The mockup's `render()`; M2 |
| `runOutcome(run)` | How one run went, for its history square | The mockup's `runState()`; M2 |
| `inferLines(estate)` | Lines, each with its members in order (role, upstream members, step), its folder and what formed it; and the pairs one signal alone links. Reads only facts, so it is empty until `loadMetadata()` has run | M5 |

`options` carries the time window (7, 14 or 30 days), main-only, and `now`, so tests pin the clock.

**Facts.** Two rules read what only the YAML and the pipeline's documentation know: idle skips manual-only pipelines, and the info item counts pipelines without an owner. Each pipeline carries optional `facts` (`manualOnly`, `runsAfter`, `owner`, plus `purpose`, its source and draft mark, `category`, `component`, the entry's details, the file to edit, problems, and display `triggers` lines for the page), and an absent fact reads as "no". `loadMetadata()` fills them through `parseTriggers()` and `resolveMetadata()`, after the run status has painted, so a page first shows the estate without them. The mockup's `render()`, `rowHtml()` and `openDrawer()` became ui components at M2; nothing in ui computes a state, a rule or a sentence. ui's entry point is `InsightsPage({ estate, now, project, links })`: the host loads the estate and says where Azure DevOps links go (`adoLinks(org, project)`).

**Theme.** ui reads only `--pi-*` CSS variables, listed in `THEME_VARIABLES`. ui exports the mockup's palette as `lightTheme` and `darkTheme`, which the dev page uses; the extension maps the variables from Azure DevOps's theme. The stylesheet ships inside ui as a string that React hoists, with every class `pi-` prefixed, and its breakpoints are container queries on the page, so a host's own navigation does not break the layout.

## Tooling

| Item | Status | Notes |
| --- | --- | --- |
| npm workspaces, `tsconfig.base.json`, TypeScript 5.9 | In place (M0) | Node 20 or later |
| Vitest | In place (M0) | Every package has `test` and `typecheck` scripts |
| React 19, Vite | In place (M0) | ui emits with `tsc`; dev serves and builds with Vite |
| `tools/tfx-run` | In place (M0) | Reads the Marketplace PAT from the environment and redacts it from tfx's output; it is never in the repo |
| `extension/scripts/package.mjs` | In place (M0) | Stages `build/` so the VSIX holds only what is staged. Refuses to run without `--overrides <path>`; there is no default path. Tests cover each refusal. Since M3 it runs `check-identifiers` on `build/` before packaging. It has no `--rev-version`: tfx would bump the staged copy, rebuilt from the committed manifest every run, so two runs would get the same version. The version comes from the overrides file instead |
| `overrides/release.example.json` | In place (M0) | The release publisher's placeholder; `release.json` is gitignored |
| `capture-fixture` | In place (M1) | `npm run capture-fixture -w @pipeline-insights/core -- --org … --project …`; runs under `vite-node` with a read-only PAT. Its PAT-based source sits in `core/capture/`, outside `src/`, because core has no network; `src/` builds without Node's types. A recording is a real project's data and goes to the gitignored `core/fixtures/recorded/` |
| `tools/check-identifiers.mjs` | In place (M3) | Scans the staged `build/` directory and fails a VSIX that carries any pipeline, repo, organization or owner name or GUID the fixtures hold, a run URL with a run id, a subscription path, or a match for the private denylist when the machine has one. Its fixture deny-list is read from `core/fixtures/` and `recorded/`, so a recording extends it |
| `tools/check-denylist.mjs` | In place | `npm run check:denylist` scans every file in the project against a private denylist kept outside the repo (`$PI_DENYLIST`, else `~/Source/.azure-devops-extensions-private/denylist.txt`). Hits are reported by denylist line, never by the matched text. No denylist, nothing to check |
| Pipeline task package, agent harness | Left out | Insights has no pipeline task |

## Publishing

Dev builds go out under a dev publisher, private, shared only with a test organization. Release goes out once, later, under the release publisher.

**A dev publish, in order.** `tools/publish-dev` runs all seven steps, from a login shell so the Marketplace PAT is set: `zsh -lc 'tools/publish-dev'`, or `--version X.Y.Z` / `--no-wait`. The dev overrides file is committed at `extension/overrides/dev.json`; the script stages a copy with this run's version.


1. Check the version is free: `tfx extension isvalid` must say "Could not find extension version". Versions can never be reused.
2. Run `typecheck` and `test`.
3. Package with `--overrides` naming the dev overrides file, plus this run's version in a staged copy.
4. Publish. Do not pass `--share-with`: a private extension cannot be shared until its version is valid, so a share bundled into the publish silently does nothing.
5. Wait for Marketplace validation, about 8 minutes, polling `isvalid` until a line reads exactly `Valid`.
6. Share with the test organization, on the first publish only; sharing persists across versions.
7. On the first publish only, install it in the test organization; sharing is not installing.

**Known traps:** `tfx` exits 255 on an upload Marketplace accepted, so success is read from `isvalid`, never the exit code. Every Marketplace command needs `--service-url`, which `tfx-run` supplies.

**Release.** Copy `release.example.json` to `release.json`, fill in the release publisher, and publish with that override. It creates a new extension, not an upgrade of the dev one.

## Fixtures and the local dev page

Design iteration runs on fixture data in a local page, because a test organization can only show its own pipelines. A fixture is an estate that a `FixtureSource` replays through the same `PipelineSource` interface.

**The contoso estate.** `core/fixtures/contoso.ts` builds the committed fixture, `contoso.json`: a made-up `contoso` organization whose `Platform` project holds 33 pipelines in six repos, two of them deleted. It is written by hand, not recorded, and built to hold every case the rules and the page must get right: release lines joined by completion triggers and by a shared name and CI path folder, suggestions, a deploy failing at a stage, a pipeline failing on main while newer runs are on branches, stale and fresh approval waits with two stage groups on one pipeline, unreliable pipelines in one window only, idle pipelines with and without triggers, every trigger kind, drafted, derived and structural purposes, a repo with no metadata file, unreadable repos and a disabled pipeline with a schedule set in its settings. Run lengths come from a seeded PRNG, so every build is the same. `npm run fixture -w @pipeline-insights/core` rewrites the JSON, and a golden test fails if the JSON is not what the generator builds.

**Capture.** `capture-fixture` runs `loadEstate()` and `loadMetadata()` through a recording source wrapped around a PAT-based one, so it makes exactly the calls the extension will. It saves the trimmed responses, the build-validation policies, the pipeline folder listings, the YAML and metadata text, and the capture time. Trimming happens in every source, so a fixture holds no run parameters, requesters, log URLs or job and task records. `--files-into <fixture>` adds only the files to an existing fixture, leaving its runs and so its golden alone. `--overlay <Repo>=<checkout>` swaps in a working tree's copy of each file it read, with the object id git would give it, and the fixture lists each overlay under `files.overlays`. A recording is useful for checking the page against a real project locally; it is that project's data and is never committed.

**Facts.** `loadMetadata()` reads them from the fixture's files, and both the port and the oracle take them as input. `contoso.facts.golden.json` keeps them, one pipeline per line, so a change to the metadata rules or to the estate shows its effect for a human to check.

**Golden tests.** The mockup's own `analyse()`, `attention()` and `runState()` are the oracle, copied verbatim into `core/test/oracle/`. A test-side adapter reshapes the fixture the way the mockup's data was built, sharing no code with `src/`. In every view (each window, main-only on and off) and with `now` pinned to the fixture's time, the port must give the same states, window stats, estate totals, run outcomes, and attention items (kind, pipeline, priority, run, title and sentence). Sentences are compared as plain text, because the mockup's carry HTML. One sentence changed on purpose at M4, the no-owner item's, which named a Pipeline Catalog page; the comparison substitutes the new one, in `core/test/oracle/compare.ts`. The mockup's archive-folder rule was dropped on purpose on 2026-10-04: the oracle's wrapper shows every pipeline and gives `ARCHIVE` a value no folder can equal, so its copied lines stay verbatim. Retired pipelines (archived or disabled, since 0.1.3) are left out of the totals, counts and attention items without touching those lines either: `compare.ts` runs the mockup a second time over the pipelines that are not retired, and takes those from it. The mockup's results are also kept in `contoso.golden.json`, one line per pipeline or item, and `contoso.lines.golden.json` holds the lines and suggestions. A change becomes the new golden once a human has checked that file's diff (`npx vitest run -u` rewrites it). On the contoso estate (14 days, main only) the rules give 22 healthy, 4 idle, 3 waiting, 2 failing and 1 only run from branches, 6 lines and 5 suggestions.

**Small synthetic fixtures** cover the edges, run through the same oracle: partially succeeded, last run canceled, never run, approvals at each depth, the 25% and four-run edges of "unreliable", staleness judged on the oldest waiting run, and idle or no-owner exclusions. The metadata rules have their own unit tests.

**Kept out of the package.** Fixtures are imported only by tests and the dev page, so the bundler never reaches them. The identifier check scans the staged `build/` directory as a second guard.

**Dev page.** `npm run dev -w @pipeline-insights/dev` serves the ui on the contoso estate, with light and dark themes and a control to move `now`. A live mode can come later through a local Vite proxy that adds the PAT on the server side, so the PAT never reaches the browser.

## Milestones

Rules first, then the page on fixture data, then Azure DevOps. Each milestone either ports something proven in the mockup or tests a claim [the design](design.md) marks as untested.

| # | Delivers | Proves or tests |
| --- | --- | --- |
| M0 | Workspace and tooling in place; empty packages that build, typecheck and test | The toolchain works. Done 2026-10-03 |
| M1 | Core types, `FixtureSource`, `capture-fixture`, `pipelineState()` and `attention()` ported, golden tests | The rules match the mockup. Done 2026-10-03 |
| M2 | ui at mockup parity on the dev page: controls, Needs attention, Estate health, folder blocks, side panel | The layout. Done 2026-10-03, matched to the existing mockup |
| M3 | The extension in the test organization: Insights hub, SDK token, ADO data source, build and code read scopes | Done 2026-10-03. The hub target works, and there is no true full screen; the page fills the content area. 7 pipelines load in 0.7 to 1.4 s. Also landed: older runs' stages load when the side panel opens, unfinished runs refresh every 60 seconds, and the identifier check runs on every package. Details in [design.md](design.md), "Where it lives" and "Data and sign-in" |
| M4 | `resolveMetadata()`, `parseTriggers()`, the metadata reader; folder listing and the object-id cache | The metadata rules. Done 2026-10-03; the metadata file replaced the header and sidecar formats on 2026-10-04. core ships js-yaml for triggers and metadata, about 13.5 KB gzipped against 30.5 KB for `yaml`; the hub bundle is about 102 KB gzipped. A derived purpose skips a boxed banner title for the paragraph under it, and `__default`, the implicit stage of a stage-less pipeline, never appears in a summary. The side panel marks a purpose draft, derived or summary, shows category, component, details and problems, and links to the file to edit. In the test organization the viewer's token reads a build-validation policy, so code read covers branch policies, and the metadata loads in 0.7 s after the first paint |
| M5 | `inferLines()`, line rows and suggestions | Done 2026-10-03. Three edges settled (design.md, "Related pipelines"): a folder counts only when it is named after a stem in the same repo, retired pipelines still take part, and differing declared components keep two pipelines apart. Facts carry every upstream (`runsAfterAll`), the CI path includes and the other repos that trigger a pipeline. The page draws a line as a collapsible row: closed, one row with a history strip per member that speaks for the worst member; open, a header with one row per member. A line opens by itself when a member is worse than idle, or when the filter matches a member. `ui/src/entries.ts` makes those decisions, so the row shape can change without touching core. The side panel names a pipeline's line and shows suggestions |
| M6 | Folder dropdown in the heading, quick filters, setup panel, loading states | Done 2026-10-04, from mockups. The heading reads `Pipeline Insights › <folder>`, and picking a folder narrows the whole page, Needs attention and Estate health included; a folder takes its subfolders, and the folder goes into the address as `?folder=`. Category and Component stay hidden until a pipeline declares one. The "Get more from Insights" panel lists what to set up and the checks that passed, and its footer shows the version. The no-owner count moved there from Needs attention; core still raises it, so the rules golden did not move. Loading: a run-history strip counts pipelines as their timelines arrive (`LoadOptions.onProgress`), then the subtitle and side panel mark what is still being read. `ui/src/scope.ts` and `ui/src/setup.ts` make the decisions. The folder right-click menu, planned for M6, is deferred (design.md, "Where it lives") |

M3 needed a small estate in the test organization that shows each state. It has 7 pipelines in three folders:

- one failing, and one partially succeeded;
- a build-and-deploy pair, whose deploy waits at an environment's approval check;
- one only run from a branch, one never run, and one whose last run was canceled.

The test organization has no hosted parallelism, so the estate runs on a self-hosted agent, and its pipelines are authorized on the agent queue and the environment.

## Open questions

- [x] Names: packages `@pipeline-insights/core`, `ui`, `extension` and `dev`; extension id `pipeline-insights`. Decided 2026-10-03.
- [x] Where the extension caches: in memory for the page's life. A persistent cache would save under a second in all on a 33-pipeline project. Decided 2026-10-04; see design.md, "Data and sign-in".
- [x] Which YAML parser core uses to read triggers, given it ships in the bundle: js-yaml, the smaller of the two at about 13.5 KB gzipped. Decided 2026-10-03.
- [ ] How design changes reach ui: as a revised HTML mockup to match, or as components?
