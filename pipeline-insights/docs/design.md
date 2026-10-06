# Pipeline Insights: design

An Azure DevOps extension page for seeing every pipeline in a project at once.

Last revised 2026-10-05. This file is the source of truth for the design; the build plan is
[build-out-plan.md](build-out-plan.md). Examples use the synthetic `contoso` estate the tests run
on (`core/fixtures/contoso.ts`): 33 pipelines in the `Platform` project, across six repos.

## Summary

Pipeline Insights is a page inside Azure DevOps that shows every pipeline in a project at once, tells the viewer what needs attention first, and groups the rest by pipeline folder. It is an extension, because Azure DevOps has no such view and none is planned.

**The problem.** A project with a few dozen pipeline definitions, spread across several repos and a handful of folders, is shown by Azure DevOps as a flat list with one latest-run icon each. It has no view across pipelines, no summary, and no way to see approvals parked for days. The built-in dashboard widgets show one pipeline per widget. The Marketplace has project-wide counters but nothing that groups by folder or explains what is wrong. Microsoft's roadmap (updated 2026-09-18) has no dashboard or cross-pipeline work for Azure DevOps Services.

**Goals**

- Answer "what needs me right now?" before anything else, in plain sentences, most urgent first.
- Show the health of every pipeline at a glance, and each folder's health in one line.
- Show each pipeline's recent history, its latest run's stages, and what it is for.
- Live in Azure DevOps, under the viewer's own sign-in, with no stored credential.

**Non-goals**

- Running, approving or cancelling pipelines. The page links to Azure DevOps for every action.
- Replacing the run results page, logs or test results.
- Editing pipeline descriptions inside the extension (see Pipeline descriptions and owners).
- Covering other projects or organizations in the first version.

## Where it lives in Azure DevOps

The main experience is a full-width page called **Insights** in the Pipelines menu, beside Pipelines, Environments and Releases. Smaller entry points lead into it.

| Entry point | Extension point | Role | Version |
| --- | --- | --- | --- |
| Insights page in the Pipelines menu | `ms.vss-build-web.build-release-hub-group` (hub) | The main experience: everything in this document | 1 |
| Folder right-click menu | `ms.vss-build-web.pipelines-folder-menu` | "Open in Insights", filtered to that folder | Future enhancement to consider |
| Dashboard widget | Dashboard widget contribution | Compact summary for team dashboards and wall screens, linking into the page | 2 |
| Button on a pipeline's page | `ms.vss-build-web.pipelines-header-menu` | Jump from one pipeline to its folder in Insights | Later |

The folder menu was deferred on 2026-10-04: the heading's folder dropdown covers the same need from inside the page. A probe was built (an action on the folder menu that logged what Azure DevOps hands it and opened the hub with `?folder=`) but never tried in the test organization, so the target and the shape of its context are still unverified. If it is picked up, the hub already opens on `?folder=`.

A tab on a run's results page is deliberately not used. It shows one run, which is what existing extensions already do.

The page sits inside Azure DevOps's own top bar and left menu. The left menu can be collapsed. Checked in the test organization on 2026-10-03:

- The hub target works. **Insights** appears in the Pipelines menu, after Library.
- The menu icon is the `AnalyticsView` glyph from Azure DevOps's own icon font, the way its Pipelines, Environments and Library entries are drawn, so it follows a theme change at once. The light and dark PNGs it replaced kept the previous theme's colour until the menu redrew. Only names in the subset Azure DevOps loads draw anything: `BarChartVertical` is not in it and drew nothing. Checked on 2026-10-04.
- An extension page has no true full screen. The hub fills Azure DevOps's content area, which is enough at a desk. The dashboard's own full-screen mode with the widget remains the route to a wall display.

## The page

The page reads top to bottom from "what needs me" to "everything else". Guidance comes first, then pipeline health, then one block per pipeline folder. Clicking any pipeline opens a side panel.

```text
+----------------------------------------------------------------------------+
| Azure DevOps top bar                                                       |
+------------+---------------------------------------------------------------+
| Pipelines  | Controls: window 7/14/30 days, main only, filters             |
|            +------------------------------------+--------------------------+
| menu       | NEEDS ATTENTION (emphasised)       | Pipeline health          |
| [Insights] | most urgent first, one sentence    | [==========|==|=|-]      |
|            | each:                              | count per state;         |
|            | catalog-sync-etl-deploy: failed    |   click to filter        |
|            |   at Ring-2                        | runs, % succeeded,       |
|            | config-sync-build: approval        |   waiting                |
|            |   waiting 5d                       |                          |
|            | infra-stacks: a run waiting        |                          |
|            +--------------------------------------+- - - - - - - - - - - - +
|            | Folder block: \services\production   : Side panel             :
|            | header: one-line count per state     : (a row click opens it) :
|            |  X  name, purpose  [#########] >>>>> : purpose, owner         :
|            |  !  name, purpose  [#########] >>!-- : triggers, YAML         :
|            |  o  name, purpose  [#########] >>>>> : recent runs, each      :
|            | state, name, recent runs, stages, %  :   with its stages      :
|            +--------------------------------------:                        :
|            | \tools, \testing, \in-development    : Open in Pipelines      :
|            +- - - - - - - - - - - - - - - - - - - :                        :
|            | (one block per folder, all open)     :                        :
+------------+--------------------------------------+- - - - - - - - - - - - +
```

The attention list is the one emphasised region. Clicking any pipeline row opens the side panel over the right of the page.

| Region | What it shows | Why it is there |
| --- | --- | --- |
| Heading | `Pipeline Insights › <folder>`. The folder is a dropdown of every folder with its pipeline count, subfolders indented under their parent, and "All folders" in grey when none is picked. "Pipeline Insights" goes back to every folder. | Narrows the whole page to one part of the estate. |
| Controls | Time window (7, 14 or 30 days), main branch only (on by default), quick filters, filter box | The window drives success rates and failure counts. Main-only keeps PR and feature-branch runs from making a pipeline look broken. |
| Needs attention | One sentence per problem, most urgent first: pipeline name, what is wrong, where (the stage), how long ago, and an Open run link. Six shown, "Show all" for the rest. | The page's main job: tell the viewer where to start. |
| Pipeline health | A segmented bar and a count per state (Failing, Waiting for approval, Running, Healthy, Idle 30+ days and others). Below it: runs in the window, percent succeeded, runs waiting for approval. Clicking a state filters the page. Archived and disabled pipelines are not counted, and a line says how many were left out. | The whole estate in one glance, and the fastest way to narrow it. |
| Folder blocks | One collapsible block per pipeline folder, open by default. The header carries a one-line state summary. Inside, one row per line or standalone pipeline, worst state first, with archived and disabled ones last and dimmed. | Folders are a project's existing grouping, so no new taxonomy is needed. |
| Pipeline row | State icon; name, purpose and "Runs after X" when it is chained; the last 15 runs as coloured squares, oldest to newest, with PR runs drawn shorter; the latest run's reason, age and stage strip, naming the stage that is waiting or failed; success rate, run count and median duration for the window | Enough to judge a pipeline without opening it. |
| Side panel | State and folder; Open in Pipelines, View YAML and Edit description links; purpose (marked draft, derived or summary), owner, category, component, triggers, YAML path, what to fix in the metadata, window stats; the entry's details; recent runs, each with its stages listed | The detail for one pipeline, without leaving the page. |

**Folder and quick filters.** Decided 2026-10-04 from mockups.

- A folder includes its subfolders: `\services` holds no pipelines of its own, only `\services\infrastructure` (2) and `\services\production` (8). `\services` never matches `\services-old`.
- The folder and the quick filters narrow everything on the page, Needs attention and Pipeline health included, not only the folder blocks.
- Lines are inferred from the whole estate first and then narrowed, so a filter never changes which pipelines group. A line that spans two folders keeps only the members in view, filed under the last of them; one left with a single member shows it alone.
- The picked folder goes into the page address as `?folder=`, so a bookmark reopens it. Opening the page with `?folder=` starts from the default settings with only the folder set.
- Quick filters: **Repo**, shown when there are two repos to pick from among the pipelines in view; **Category** and **Component**, shown once any pipeline declares one. Before the descriptions load nothing is declared, so they never flash in and out. A picked filter is tinted, and "Any" clears it.

**Setup panel.** "Get more from Insights", a tab docked at the bottom right that opens upward, with a count of what is left to set up. It is worked out for the whole project, whatever folder is in view, and says nothing until the descriptions have loaded. It has three groups:

- **To set up**, each saying what it unlocks and how far along it is: owners, descriptions, confirming drafted descriptions, description problems, repos with no metadata file, problems in a metadata file, entries no pipeline uses, pipelines whose YAML could not be read, unreadable branch policies, components (while pipelines look related), categories (while none is declared).
- **Checked**, the checks that passed.
- **How to describe a pipeline**, with the entry to paste.

Its footer shows the extension's version, when the data was read and how long the descriptions took. It links to the extension's Marketplace item, built at runtime from the extension context, so no publisher is written down. The page remembers per browser whether the panel was left open; nothing else is stored. The no-owner count lives here rather than in Needs attention: it is setup, not something urgent.

**Loading.** Before the first data arrives, a run-history strip fills in and repeats, with "N of M pipelines" once the definitions are read. A pipeline counts as ready once every timeline it needs is in. After the first paint, the subtitle notes "reading descriptions and lines" until the metadata arrives, a spinner beside "data as of" marks a refresh, and the side panel pulses a stage strip for each older run whose stages it is reading.

The stage strip draws one segment per stage, so a 30-stage infrastructure run still fits a row. Hovering a square or a segment names the run or the stage.

## State model and attention rules

Each pipeline gets exactly one state, the worst that applies, judged on main-branch runs unless the toggle is off. Attention items are generated separately, so one pipeline can raise more than one.

**Pipeline state**, first match wins:

1. **Failing**: the latest finished run failed.
2. **Waiting for approval**: an unfinished run has a stage paused at an approval check.
3. **Running**: an unfinished run, not waiting.
4. **Partially succeeded**: the latest finished run partially succeeded.
5. **Last run canceled**: the latest finished run was canceled.
6. **Idle 30+ days**: no run queued in 30 days.
7. **Healthy**: none of the above.
8. **Only run from branches**: runs exist, but none on main (shown only with main-only on).
9. **Never run**: no runs at all.

**Attention rules**, in priority order:

| Priority | Rule | Sentence pattern |
| --- | --- | --- |
| 1 | Latest finished run failed | Names the failed stage. Adds the failure count in the window, or "the run before it passed", or "it is the only run on main". Mentions newer runs on other branches. |
| 2 | A run has waited at an approval more than a day | "Waiting more than a day, so it may be stale. Newer runs of this pipeline can queue behind it." |
| 3 | A run is waiting at an approval | Groups runs waiting at the same stage. Mentions a failed stage in the same run. |
| 4 | Failed at least 25% of at least 4 runs in the window, latest passed | "Unreliable lately: failed N of M runs." |
| 5 | Idle 30+ days but has a CI, schedule or pipeline trigger | "Has triggers but hasn't run lately." Manual-only pipelines are never flagged as idle, and neither is one whose YAML could not be read, since its triggers are unknown. |
| 6 | The YAML file is not on the default branch | "YAML missing on main." The pipeline cannot run until the file is restored, or it is disabled or deleted. |
| Info | Pipelines with no owner | In the setup panel, not Needs attention. Core still raises it. |

No rule fires for an archived or disabled pipeline: see "Archived and disabled pipelines" below.

Within a priority, the oldest item comes first.

**Missing or unreadable YAML.** Decided 2026-10-04. A YAML pipeline whose file is not in its folder's listing on the default branch raises "YAML missing": that is certain, and the pipeline cannot run. A listing or file that cannot be read at all is not the same thing. Azure DevOps answers a deleted repo and a repo the viewer cannot open with the same error (TF401019), so the page cannot tell them apart and raises nothing in Needs attention; the setup panel names those pipelines instead, leaving out archived and disabled ones, and does not count them as undescribed. Either way the triggers are unknown, so neither raises the idle item. Classic pipelines have no YAML and are not affected. In the contoso estate the three pipelines in `\archive` point at deleted repos: reports-api-build and legacy-export-build-deploy appear in the setup panel; legacy-export-run is disabled, so it appears in neither.

**No archive folder.** Azure DevOps has no notion of an archived pipeline, so the page infers none from a folder's name: every folder is an ordinary folder. Decided 2026-10-04. An `\archive` folder gets no special treatment, in the rules or in lines; a pipeline is retired by its metadata entry or by disabling it.

**Archived and disabled pipelines.** Decided 2026-10-04, from mockups, in 0.1.3. A pipeline is retired when its entry says `archived: true` or it is disabled in Azure DevOps. A retired pipeline stays listed and keeps its state, but:

- it raises no attention item, a failed run included, and is not counted among pipelines with no owner;
- Pipeline health leaves it out of the state counts and the run totals, and says how many it left out ("Not counted: 1 disabled pipeline.");
- clicking a state in Pipeline health does not show it, since it was not counted;
- it is listed last in its folder, dimmed, tagged `archived` or `disabled`, and the folder header counts it apart from the states;
- the setup panel leaves it out of every progress count, though an archived entry's problems are still listed, since the entry is still read;
- the side panel says why it is quiet;
- lines are inferred as before, from every pipeline. A line whose members are all retired is drawn quiet and sorts last; a partly retired line takes its state from its other members, and only the retired rows are dimmed.

The field differs from an archive folder in being declared, not inferred: a repo says it of one pipeline, in a file a PR reviews. It is for a pipeline that must stay runnable, such as a one-off utility run by hand, which disabling would stop from queuing. Retiring a pipeline for good is still done the native way, by disabling or deleting it, and the page treats a disabled pipeline the same way. That is also how a pipeline whose repo was deleted is retired: no file can hold its entry, since an entry is keyed by YAML path in its own repo's file. A cross-repo section keyed by definition name or id was considered and rejected, for the reasons the entry key rejects them. So were a `hidden` field, which would take the pipeline off the page with a control to show it again, and a folded row at the foot of each folder: once a pipeline counts toward nothing, removing its row as well gains little.

**What the rules produce on the contoso estate** (14-day window, main only; `core/fixtures/contoso.golden.json` holds every view):

| Pipeline | Item |
| --- | --- |
| model-retrain-run | Last run on main failed; it is the only run on main; 8 newer runs from other branches, the latest succeeded |
| catalog-sync-etl-deploy | Last run on main failed at Ring-2 Production; the run before it passed |
| config-sync-build | Approval waiting a long time at Apply |
| webapp-storefront-deploy | 3 runs waiting at Ring 2: production; in the same run, the region east schema plan failed |
| webapp-storefront-deploy | A run waiting at Ring 2: production, region east |
| infra-stacks | A run waiting at Stack 3 — Shared network (Deploy) |
| warehouse-region-east-deploy | Has triggers but no runs in 39 days |
| (32 pipelines) | No owner set |

State counts are 22 healthy, 4 idle, 3 waiting, 2 failing and 1 only run from branches. A parked approval like config-sync-build's matters beyond tidiness: every later run of that pipeline queues behind it.

## Data and sign-in

The page reads Azure DevOps's REST API from the viewer's browser, using the token the extension SDK hands it for the signed-in viewer. There is no PAT, no server and no copy of the data outside Azure DevOps. Each viewer sees only the pipelines they already have access to.

| Data | API call | When | Notes |
| --- | --- | --- | --- |
| Pipelines, folders, repo, YAML path, disabled flag, UI-set triggers | `build/definitions?includeAllProperties=true` | Page load | One call for all |
| Recent runs | `build/builds?definitions=<all ids>&maxBuildsPerDefinition=15&queryOrder=queueTimeDescending` | Page load | One call |
| Stages and approval waits | `build/builds/{id}/timeline` (records of type `Stage` and `Checkpoint.Approval`) | Page load for each pipeline's newest run and every unfinished run; older runs when the side panel opens | Throttled at 8 at a time |
| PR triggers | Branch policy configurations, build-validation type | Page load | Optional; on failure the PR lines are dropped |
| Purpose, owner, category, trigger summary | Git items: each pipeline folder and each repo's well-known folders listed once, then each changed YAML and metadata file | After the run status paints; cached by git object id | See Pipeline descriptions and owners |

**Scopes:** build read, plus code read for branch policies and the pipeline and metadata files. The token is `SDK.getAccessToken()`, sent as a bearer token on each call. The calls are plain `fetch` against REST, the same calls `capture-fixture` makes, so the extension's data has the fixtures' shape. Code read covers branch policies: in the test organization the viewer's token read a build-validation policy and the page showed its PR line. Checked at M4, 2026-10-03.

**Load time.** In the test organization, 7 pipelines and 15 runs took 0.7 to 1.4 seconds: two list calls and about 9 timelines. The metadata followed in 0.7 seconds on a first visit: the definitions and policies again, one folder listing and 8 files. On a project of about 33 pipelines, 355 runs and 39 timelines, measured on 2026-10-04 from a developer machine with a read-only PAT making the same calls, the first paint took 1.1 to 1.6 seconds and the metadata 0.9 to 1.0 seconds after it. The hub adds the SDK handshake on top.

**Cache.** Kept in memory for the page's life, not persisted. Decided 2026-10-04. Only immutable data is cached: finished runs' stages by run id and file text by git object id. On that 33-pipeline project a warm cache saved 0.3 to 0.6 seconds of the first paint (the unfinished runs' timelines remain) and about half a second of the metadata, too little to justify IndexedDB's storage handling. Revisit for a much larger project; the `Cache` interface lets a host persist without touching core.

**Refresh:** unfinished runs are re-read every 60 seconds while the page is open, and finished runs never change, so they are cached for the session. The hub does this by running `loadEstate()` again on the same cache: the two list calls and the unfinished runs' timelines go out, and finished timelines come from the cache. An older run's stages are read when the side panel opens and cached the same way.

**Theme.** The SDK writes Azure DevOps's theme, about 120 variables, onto the page, and fires `themeApplied` each time it changes. The hub maps surfaces, lines and text from it. Succeeded, failed, partial and running take the colours Azure DevOps's own status icons read (`component-status-success`, `-error`, `-warning`, `-info`), and ui's palettes hold the values those icons fall back to, the same in both themes. The mockup's lighter dark-theme colours read as muted beside Azure DevOps and were dropped on 2026-10-04. The other states have no Azure DevOps colour and come from ui's light or dark palette, judged by the background colour the browser resolves. Theme values are not always literal colours: `background-color` arrives as `rgba(var(--palette-neutral-0), 1)`, so a string test read the dark theme as light. The soft accent used for hover is mixed from Azure DevOps's accent and surface. A theme change applies without a reload.

**Two traps worth knowing:**

- Order runs by queue time, never by finish time. Ordering by finish time drops unfinished runs, which makes a pipeline that is waiting for approval look idle.
- A run that is waiting for approval reports status `inProgress`. Only its timeline shows the wait: a `Checkpoint.Approval` record still in progress under a pending stage.

## Pipeline descriptions and owners

Each pipeline's purpose, owner and category live in its own repo, in one metadata file per repo, `pipelines.meta.yaml`, with an entry per pipeline keyed by its YAML path. The extension reads it and never writes it. Decided 2026-10-04; it replaces an inline header and a Markdown sidecar considered on 2026-10-03.

Why one file, not a sidecar beside each YAML: one place to read and review a repo's whole catalog, room for more than pipelines later (component definitions, say), and no new file in a pipeline folder for a trigger's wildcard to match. The cost is drift: a sidecar sits beside its YAML in a rename PR, and an entry does not. The setup panel answers that by listing entries whose YAML path no pipeline uses. Keyed by YAML path, not definition id or name: the path is in the repo, so a PR shows whether it is right, while an id exists only once the pipeline is registered after its YAML merges, and changes when a definition is re-created; a name can be changed in the web UI.

| Field | Required | |
| --- | --- | --- |
| purpose | Yes | One or two sentences. Write it as a folded block (`>-`): a plain YAML value cannot contain `: `, and the draft mark `(TODO: verify)` does. |
| owner | Yes | A team or a person. |
| category | No | A short slug such as `service-production`. |
| component | No | Which thing it ships; joins it to a line (see Related pipelines). |
| details | No | Markdown shown in the side panel, such as a runbook. |
| archived | No | `true` keeps the pipeline listed but out of every count and of Needs attention. See "Archived and disabled pipelines". Anything but `true` or `false` is flagged. |

`category` says what kind of pipeline it is; `component` says which thing it ships. Set `component` only where triggers and names cannot show the link. An expected-cadence field was considered and rejected.

```yaml
# Read by Pipeline Insights. Each entry is keyed by its pipeline's YAML path.
pipelines:
  pipelines/pricing-app-build.yaml:
    owner: Platform Team
    category: service-production
    purpose: >-
      Builds and pushes the pricing app image. Its completion triggers
      pricing-app-deploy.
```

`pipelines:` is the only section today. Others are reserved for later; a section the reader does not know is flagged, so a misspelt `pipeline:` is not silently ignored. Paths match without a leading `/` and in any case.

**Where the file lives.** Insights looks in `pipelines/`, then `.azuredevops/`, then the repo root, and uses the first it finds; a second one is flagged. A viewer can tick "Search the whole repository for the metadata file" in the setup panel, which lists every file in a repo that has none in those three places and takes the shallowest match. It is off by default because that listing is the heaviest call the page would make (a monorepo of about 2,000 files returns some 900 KB of JSON), and it is remembered per viewer, in the browser. A host whose data source cannot list a whole repo does not offer it.

**Which source wins**, first match:

1. The entry's purpose.
2. The first paragraph of the YAML's opening comment, marked "derived".
3. A structural summary from the YAML and runs, e.g. "Runs after pricing-app-build; 3 stages ending in Ring-2 Production".
4. "No description". Owner comes only from an entry, never from a guess, and is kept when the purpose falls back.

A purpose ending `(TODO: verify)` is a draft: the mark is removed and the page tags it draft. An owner of `TODO` reads as not set. The derived purpose skips editor directives and lines with no letters or digits, and passes over a banner title boxed between `# ====` rules for the paragraph under it. The structural summary ignores `__default`, the one stage of a pipeline that declares none.

Metadata belongs to the YAML file, so definitions that share one file share an entry. It is read from each definition's default branch, so a change takes effect when it merges there.

**How the page reads it.** A TypeScript reader in the extension, in the viewer's browser, so a project needs no pipeline or other setup. It lists each pipeline folder and each repo's three well-known folders once, which gives every file's git object id, and fetches only files whose id changed since the viewer's last visit. Metadata loads after the run status paints, so it never delays the attention list.

**The setup panel checks it** against the pipelines that exist: repos with no metadata file (repos that cannot be read at all are left out; their pipelines already show as unreadable), problems in a file as a whole, problems in an entry (on that pipeline's side panel), and entries whose YAML path no pipeline in the project uses.

**What a project has to do:**

1. Install the extension, granting build read and code read.
2. Add a `pipelines.meta.yaml` to each repo that holds pipeline YAML, with an entry per pipeline, purpose and owner set.
3. Rename an entry in the same PR as its YAML.
4. Act on the page's "looks related" suggestions: set a shared `component` to group, or leave it unset to keep the pipelines apart.

Check that `pipelines/pipelines.meta.yaml` sits outside every pipeline's CI trigger paths: a `pipelines/**` include would run that pipeline on every edit of the file. A path `exclude` does not reliably help either: a merge that only deleted an excluded file has been seen to start the pipeline anyway.

**Editing:** the side panel's Edit description link opens the repo's metadata file in Azure DevOps's file view, which has the Edit button. For a pipeline with no entry it reads Add a description; in a repo with no file yet it opens the first well-known folder that exists, where New file creates one.

**Also considered:** an inline `@pipeline-doc` header in each YAML (rejected 2026-10-04: editing a pipeline's YAML runs that pipeline, some with no approval), a `.pipeline.md` sidecar beside each YAML (rejected the same day for the single file; see above), custom properties on the definition (kept in reserve: readable, but invisible in the UI and unreviewed), the extension's own storage (rejected: a second source of truth), and definition tags (rejected: labels only, and rarely used).

## Related pipelines

Pipelines that ship the same thing form a **line**, shown as one row and ordered CI → build → deploy. Links come from triggers. Grouping needs two signals that agree, or a declared `component`. Decided 2026-10-03.

**Runs-after links** come only from triggers: a YAML pipeline resource with a trigger, or a build-completion trigger set in the UI. They are certain and need no upkeep. Run history can confirm a link through `triggerInfo`, never through `reason`, which can read `manual` for runs a completion trigger started.

**A line forms** when any of these holds:

1. A runs-after link joins two pipelines.
2. Two pipelines in the same repo share a name stem and a component folder in their CI path filters. The stem is the definition name minus role words (ci, build, deploy, run, job, test, unit, testing, release): `db-tool-job-build` gives `db-tool`. A component folder is a folder in a path filter that is named after a stem in the same repo, its words in any order, so `src/app-admin` belongs to admin-app-ci. `src/` is not required.
3. Both declare the same `component`, in any repo.

A folder that names no stem does not count. That drops what links nearly every pipeline (`src/shared-lib`, `src/shared-web`, `src/models`) with no list to keep, and root files such as `src/uv.lock` are not folders. Counting the stems that share a folder does not work: `src/shared-web` is filtered on by two stems, the same as `src/db-tool`, which must raise a suggestion.

One signal alone, a stem or a folder, never groups. It raises a suggestion in both pipelines' side panels: "Looks related to X. Set component to group them." A declared `component` overrides everything inferred: two pipelines that declare different components never join, whatever triggers link them, and get no suggestion. A pipeline whose facts have not loaded takes no part, so the first paint has no lines.

**On the page** a line is one collapsible row, decided 2026-10-03. Closed, it shows a history strip per member, and its latest run and success rate speak for its worst member, or its most downstream one when none is worse. Open, it is a header with one row per member, labelled by role. A line opens by itself when a member is worse than idle (failing, waiting, running, partially succeeded or canceled), and when the filter matches a member; a click overrides that until the page reloads. The header borrows its purpose from the most downstream member, since a line has none of its own, and notes a member that another repo triggers. `ui/src/entries.ts` makes these decisions and the components only draw, so the row shape can change without touching the rules.

**Order within a line** follows the runs-after links. Pipelines with no link come first, labelled by their name's role word. A repo-wide check, such as orders-unit-tests (the pre-merge PR suite for all of Orders.Apps), belongs to no line and keeps its own row. A trigger from another repo, such as webapp-admin-build rebuilding when Orders.Deployment's rendered config changes, shows as a note on the row, not as grouping.

**What the rules produce on the contoso estate** (`core/fixtures/contoso.lines.golden.json`):

| Line | Pipelines | Folder | Formed by |
| --- | --- | --- | --- |
| file-import-app | build → deploy | `services\production` | Trigger |
| pricing-app | build → deploy | `services\production` | Trigger |
| catalog-sync-etl | build → deploy | `in-development` | Trigger |
| db-tool | ci, job-build | `tools` | Name and `src/db-tool` |
| webapp-storefront | ci, build → deploy | `tools` | Trigger; name and `src/webapp-storefront` |
| webapp-admin | ci, build → deploy | `tools` | Trigger; name and `src/webapp-admin` |

| Suggestion | Looks related to | Signal |
| --- | --- | --- |
| legacy-export-run | legacy-export-build-deploy | Name only |
| price-check-gate-job-build | pricing-app line | Shares `src/app-pricing`: a dependency, not the same line |
| admin-app-ci | db-tool line | Shares `src/db-tool` |
| db-tool-job-run | db-tool line | Name only |
| price-check-gate | price-check-gate-job-build | Name only |

No line spans two folders there; if one did, it would sit in its deploy pipeline's folder.

## Hosts

core and ui know nothing about Azure DevOps's SDK: each host supplies the data source, so the rules exist once and the page can be rendered anywhere a `PipelineSource` can be written. The extension and the local dev page are the two hosts today. Decided 2026-10-03.

| Layer | Holds | Depends on |
| --- | --- | --- |
| core | State model, attention rules, metadata reader, line inference | Nothing: plain TypeScript, no network calls, no ADO SDK |
| ui | React components, styled through CSS variables that each host themes | core |
| Data source: extension | ADO REST calls from the browser with the viewer's own token | ADO extension SDK |
| Data source: dev page | A recorded or synthetic fixture, replayed | core |

The ui layer does not use `azure-devops-ui`, which only looks right inside Azure DevOps.

## Delivery

Iterate under a dev publisher, installed only in a test organization. Once the extension is right, publish it under its release publisher. Decided 2026-10-03.

- **Publisher.** An extension's identity is `{publisher}.{id}`, so the release version is a new extension, not an upgrade of the dev one: installing the dev build anywhere people rely on it would leave them to be migrated off it later. Nothing carries over between the two, and nothing needs to, because the extension stores no data of its own.
- **Install.** Installing it in an organization may need an org admin, and a review of what it can read. Its read-only build and code scopes help that case.
- **Repo.** The manifest names no publisher. A committed `release.example.json` is the release template, with a placeholder version; the filled-in `release.json` is gitignored. Fixtures stay out of the package.
- **Tooling.** Build, package and publish use an override-file split between dev and release publishers. The test organization can only show its own pipelines, so it proves the ADO side (placement, token, scopes, full screen). Design iteration happens in a local dev page fed with the synthetic estate.

**Phases**

1. The Insights page: controls, Needs attention, Pipeline health, folder blocks, side panel, folder dropdown, quick filters and setup panel. Iterated under the dev publisher in the test organization. Done through M6 on 2026-10-04.
2. Publish under the release publisher.
3. The dashboard widget.
4. Later: the button on a pipeline's page, other projects, the folder right-click menu.

## Open questions to challenge

These are the decisions the mockup made by default. Each is worth arguing before the next mockup round.

**Layout and grouping**

- [ ] Is Needs attention the right thing to lead with? What is missing from it: long-running runs, runs queued with no agent, disabled pipelines?
- [x] A line is one row (see Related pipelines). Should that row show one combined run history, or expand to a sub-row per pipeline? Both: closed it stacks one strip per member, open it has a sub-row per pipeline, and it opens by itself when a member needs attention. Decided 2026-10-03 from three mockups.
- [ ] Are pipeline folders the right grouping? They often mix purpose (tools, services\production) with lifecycle (in-development, archive). `category` is an optional metadata field: should the page group by it where set, and by folder otherwise?
- [ ] Should ring-based deploys show their rings as columns (Ring 0, 1, 2) rather than a generic stage strip?

**Rules and thresholds**

- [ ] What does healthy mean for a pipeline that runs rarely by design? model-retrain-run runs once a quarter, and price-check-gate is manual. An expected-cadence field was rejected on 2026-10-03, so the answer has to come from the rules alone.
- [ ] Are the numbers right: an approval stale after 1 day, unreliable at 25% of 4 or more runs, idle after 30 days?
- [ ] Should a waiting approval name its approvers and link straight to the approval? That needs the approvals API and a wider scope.
- [ ] Is main-only the right default? orders-api-build-deploy also triggers on `dev` and `release/v1`.

**Scope and delivery**

- [ ] Name: "Insights", or something that cannot be confused with the per-pipeline Analytics tab?
- [ ] Does a wall display matter for version 1, which would move the widget earlier?

## References

- The mockup the rules were ported from, `insights-template.html`, lives outside this repo; its state model and attention rules are copied verbatim into `core/test/oracle/mockup.js`.

**Sources** (read 2026-10-03)

- [Extensibility points](https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops), Microsoft Learn: hub groups and Pipelines menu targets.
- [Azure DevOps roadmap](https://learn.microsoft.com/en-us/azure/devops/release-notes/features-timeline), Microsoft Learn, updated 2026-09-18.
- [Stage traceability](https://learn.microsoft.com/en-us/azure/devops/release-notes/roadmap/2024/stage-traceability), Microsoft Learn: the one related roadmap item, per pipeline only.
- [Azure DevOps Services roadmap](https://www.directionsonmicrosoft.com/roadmaps/ref/azure-devops/), Directions on Microsoft: investment going to GitHub.
- Marketplace extensions reviewed: [Release Pipeline Monitor](https://marketplace.visualstudio.com/items?itemName=EricDufur.pipeline-release-monitor), [Pipelines Monitor](https://marketplace.visualstudio.com/items?itemName=danilocolombi.pipelines-monitor), [YAML Multi-Stage Pipeline Widget](https://marketplace.visualstudio.com/items?itemName=Bookzo.yaml-multi-stage-pipeline-widget), [Build Overview Widget](https://marketplace.visualstudio.com/items?itemName=agebase.build-overview-widget), [Team Project Health](https://marketplace.visualstudio.com/items?itemName=ms-devlabs.TeamProjectHealth) (unpublished).
