# Bicep What-If: design

A pipeline task and a build-results tab that render Azure Deployment Stacks what-if output for a
multi-stack estate: filterable, ranked by severity, and honest about what it could not evaluate.

Last revised 2026-10-09, for the 1.0 release. This file is the source of truth for the design and
for the decision ids (`B3`, `E3`, `F1` and so on) that comments in the code cite. The package
READMEs hold the detail each package needs; where one goes deeper than this file, it says so.
When a decision changes, change it here in the same commit as the code it affects.

Examples use fictitious names: a `contoso` estate whose stacks are `network`, `shared-infra` and
one workload stack per environment.

## Contents

- [01 · The gap](#01--the-gap)
- [02 · Architecture](#02--architecture)
- [03 · Severity and the correctness rule](#03--severity-and-the-correctness-rule)
- [04 · Decisions](#04--decisions)
- [05 · Verified facts](#05--verified-facts)
- [06 · What `@1` freezes](#06--what-1-freezes)
- [07 · Where it stands](#07--where-it-stands)
- [08 · What would invalidate this](#08--what-would-invalidate-this)

## 01 · The gap

Azure DevOps pipeline summaries forbid JavaScript. `Distributedtask.Core.Summary` attachments are
static HTML, with no `<script>` and no external resources. A pipeline that runs what-if across
nine deployment stacks therefore produces nine static blobs, with no filter, no sort and no view
across stacks. An extension tab is the only way to get JavaScript onto that page.

The Marketplace has Bicep tooling, all of it task-shaped. Nothing renders what-if results.
Microsoft's own `BicepDeploy@0` can run a stack what-if, but it prints the result to the log.

**The case is scale, not aggregation.** A final stage that concatenates every stack's summary into
one page gives aggregation without an extension. What it cannot give is filtering, search, sort
or ranking across stacks. At nine stacks a static wall of text is annoying. An estate with one
workload stack per environment and tenant reaches thirty quickly, and at thirty it is
unnavigable.

**Goals**

- At a deploy gate, answer *what will hurt me* before *what happened in stack 3*.
- Never show a stack that was not evaluated as a stack with no changes.
- Preview with exactly the settings the deploy will use.
- Need nothing in the browser beyond reading the build: no Entra app, no admin consent.

**Non-goals**

- Comparing runs, or browsing across builds (`A4`).
- A project hub or dashboard (`A3`).
- Tenant-scope stacks, which Azure does not have.
- Plain deployments that are not stacks. `BicepDeploy@0` covers them.

## 02 · Architecture

Everything runs in the pipeline. The browser only reads.

```text
 Pipeline agent             Azure Resource Manager        Azure DevOps            Browser (tab)
 ─────────────────          ──────────────────────        ────────────            ─────────────
 StackWhatIf@1  ── PUT ───▶ deploymentStacksWhatIfResults
 (one step per  ◀─ poll ──  (or the stack itself, for
  stack)        ── DELETE ▶  create / validate / delete)
       │
       └─ ##vso[task.addattachment] ──────────────────▶ build attachments ◀── getAttachments()
                                                         (raw payload        │
                                                          + sidecar)         │
                                                        build timeline ◀──── Timeline API:
                                                                             which stages exist
```

The browser never contacts Azure Resource Manager. That is why the tab needs no Entra app
registration and no tenant admin consent, and why its only scope is `vso.build`.

One task, `StackWhatIf@1`, does one stack per step. Its `operation` input is `whatIf` (the
default), `create`, `validate` or `delete`:

- **`whatIf`** creates a `deploymentStacksWhatIfResults` resource, waits for it, redacts the
  response, attaches it with a sidecar, and deletes the result.
- **`create`** creates or updates the stack, sets its outputs as pipeline output variables, and
  attaches the redacted outcome.
- **`validate`** runs the stack's `validate` action and attaches what comes back.
- **`delete`** deletes the stack, doing to what it managed what the unmanage switches say. ARM
  returns no body, so only a sidecar is attached.

Because the preview and the deploy are the same task reading the same inputs, the unmanage
switches and `denySettingsMode` cannot drift between the what-if and the deploy it previews
(`C2`, `D3`).

Four workspaces, one VSIX:

| Package | Role |
| --- | --- |
| `packages/core` | Normalizer and severity model. No UI, no SDK, no network. Shared by task and tab, so they rank a run identically. |
| `packages/task` | The pipeline task, TypeScript on `Node20_1` and `Node24`. |
| `packages/ui` | The build-results tab, a static React 19 SPA. |
| `packages/extension` | The manifest and packaging that bind task and tab into one VSIX. |

The task ships even though the tab is the product: a build-results tab's `supportsTasks` gates on
the task being in the build definition, and there is no runtime control over whether a tab
appears ([SDK issue #85](https://github.com/microsoft/azure-devops-extension-sdk/issues/85)). A
tab-only extension would appear on every build in the organisation.

## 03 · Severity and the correctness rule

### Four axes collapse to one ranking

Stack what-if reports more than a change type. Each resource carries a **change type**, a
**management status** change, a **deny status** change, and its property deltas. Change type
alone does not capture danger: a resource going `notManaged`, or a deny mode weakening from
`denyWriteAndDelete` to `none`, is a loss of protection with no property change at all. Sorted on
change type it lands beside two hundred benign no-ops.

So `core` derives one severity, the maximum across all four axes:

| Rung | Glyph | Reached by |
| --- | --- | --- |
| `destructive` | `-` | `delete` |
| `protectionLoss` | `/` | `detach`, management status to `notManaged`, deny mode weakening |
| `create` | `+` | `create` |
| `modify` | `~` | `modify` |
| `unevaluated` | `?` | `unsupported`, a change type this build does not recognise, or a stage that attached nothing |
| `noChange` | `*` | `noChange` |

`unevaluated` was not in the first sketch. It exists because the default view hides `noChange`,
and anything Azure could not evaluate must not be swept up by a filter meant for resources known
to be fine. It sits directly above `noChange`, and the default view always includes it.

A **potential** change keeps its rung. When a stack what-if short-circuits, Azure reports each
existing resource it cannot match as a potential `detach` or `delete`, usually the same resource
it could not name. It can still be real, so it ranks where a definite one would, but the tab, the
log and the summary mark it as potential and say why Azure could not tell.

The task's log and markdown summary print the same glyphs from the same table, so the tab reads
continuously with the log. The payload mapping from deployment what-if to stack what-if, and the
parser's rules, are in [`packages/core/README.md`](../packages/core/README.md).

### The one correctness rule

**Absence of data must never render as absence of change.**

What-if stages run `continueOnError: true`, so a failed stage lands on `SucceededWithIssues` and
may attach nothing at all. A tab that rendered only the attachments it received would show eight
clean stacks as a safe deploy while the ninth was never evaluated.

Three things enforce it:

1. **The task writes a sidecar on every path out of the run**, including a compiler failure, a bad
   service connection, or ARM refusing the request. The sidecar records `status` and the
   (redacted) error.
2. **The tab reconciles against the build Timeline API, not the attachment list** (`E3`). Every
   stage named `WhatIf_*` gets a row whether or not it attached anything, and so does any other
   stage a what-if attachment traces to. Attachments join onto their stage by walking the
   timeline's parent chain, one stack per stack id. A stage with nothing attached becomes a row
   ranked `unevaluated`.
3. **`core` carries the rule inward.** Nothing it parses throws, and anything it could not
   evaluate ranks `unevaluated`. Everything it worked around comes back as a warning, so zero
   rows with zero warnings means a clean stack, and zero rows with a warning means something else.

Azure's own `properties.diagnostics` belong to the same rule. A module whose id cannot be worked
out before the deploy is left out of `resourceChanges` and named only there, so a short-circuited
what-if reads as a complete one unless the diagnostics are shown. The tab's headline says when
Azure warned that a result may be incomplete, and the task raises those warnings in the pipeline.

Everything else in this design is convenience. This is correctness.

## 04 · Decisions

Ids are stable so code and docs can cite them. A decision that changed keeps its id and says
what it replaced and when. Tags: **revised** (changed since the first design, 2026-08-25),
**cut**, **deferred**, **trap** (easy to undo by accident, expensive when undone).

### A · Product shape

**A1 · Build the extension, justified by scale.** A roll-up summary delivers aggregation without
one. Interactivity at thirty stacks is the differentiator.

**A2 · The moment of use is the pre-deploy approval gate.** Pull-request review is a near-free
second. Drift detection and post-hoc audit are out.

**A3 · A build-results tab is the only surface.** One run holds every stack's stage, so one tab can
aggregate them. A hub earns its place only once cross-run browsing exists.

**A4 · Cross-run comparison is cut from 1.0.** `cut` Attachments are still fetched by `buildId`
through a small data layer, rather than assuming the current build everywhere, so adding it
later is not a refactor.

**A5 · Match `BicepDeploy@0` unless that is nonsensical for a stack-only task.** Added
2026-10-07. Microsoft's task is what people already know, so its features and input names are the
default, and every deviation states its reason. The deviations are in `D3`, `D9` and `D10`;
differences forced by calling ARM directly rather than through the CLI are accepted.

### B · Data path

**B1 · What-if runs in the pipeline; the browser never calls ARM.** Calling ARM from the browser
needs an Entra app registration with delegated access and tenant admin consent. Running in the
pipeline also pins each result to a run and a commit.

**B2 · The transport is custom-typed build attachments, not pipeline artifacts.**
`getAttachments(project, buildId, type)` returns every stage's attachment for a run in one call,
which is the aggregation. Pipeline artifacts are blob-backed and awkward from a browser SPA.

**B3 · Attach ARM's response verbatim; version only the sidecar.** The ARM schema is not ours to
version, so the parser reads it defensively and degrades. A raw payload also lets an improved
parser re-render old runs without a pipeline re-run. The sidecar (`schemaVersion` 2) carries the
stack id, layer, status, error, producer version, Bicep version, `operation`, the request's
correlation id, and the result or stack resource id. It deliberately omits `actionOnUnmanage`,
`denySettings` and `retentionInterval`: the result echoes all three, and two records of one fact
can disagree.

**B4 · Normalize in TypeScript, in `core`.** The earlier PowerShell renderer is not ported. Its
attachment types and sidecar fields are kept, so builds it produced still read. Real captures,
scrubbed, are the test corpus, so the whole UI can be built offline.

**B5 · One attachment pair per operation.** Added 2026-10-07. A what-if attaches
`whatif.stack.json` and `whatif.stack.sidecar`, named by stack id, as before. `create`,
`validate` and `delete` attach `whatif.stack.<operation>.json` and `.sidecar`; `delete` attaches
only the sidecar. Separate types make it impossible for a `create` to displace a what-if for the
same stack. The tab reads only the what-if pair.

### C · Stack what-if

**C1 · Use stack what-if, not deployment what-if.** `revised` (during the first design) An early
plan joined deployment what-if against the stack's current state to find detached resources.
Stack what-if reports `detach` and `delete` natively, driven by the unmanage settings, plus
management and deny status per resource. That is the four-axis model, handed over.

**C2 · The unmanage switches and `denySettingsMode` are inputs to what-if.** If the preview runs
with different values than the deploy, it is a lie, most obviously about whether a dropped
resource is reported as `detach` or `delete`. One task for both (`D3`) makes the parity
structural.

**C3 · Results are named, short-lived and deleted.** The what-if result is a real ARM resource
that counts toward scope limits, and concurrent builds would collide on a fixed name. The default
name is `whatif-<stackId>-<Build.BuildId>`, retention defaults to `PT3H` (the service's ceiling),
and the task deletes the result in a `finally` unless `deleteWhatIfResult` is off. A failure to
delete never replaces the result it was cleaning up after. No sweeper: a cancelled build's result
expires within three hours. Because the result's name changes every run, `core` takes the stack
name from `deploymentStackResourceId`, never from the result's `name`.

**C4 · Lean on Azure's noise reduction; keep a thin toggle.** Azure's baseline compares against
the last deployed state and beats any hardcoded blocklist. The tab adds one toggle, *Hide
unchanged properties*, off by default, which hides only property lines that carry no difference
(`noEffect`, or before equal to after). It never hides a row, and never a line that changed.
Hiding a real change is the one failure that destroys trust. The per-stack "no baseline" badge
from the first design was not built; see [07](#07--where-it-stands).

### D · The task

**D1 · A fat task: the extension owns the logic.** `revised` (during the first design) A thin
attach-only task would leave every consuming team to reimplement the hard part.

**D2 · TypeScript on Node.** The `PowerShell3` handler requires a Windows agent. Running TypeScript
also means normalization, redaction and severity are one shared package, so task and tab agree by
construction. Everything but two Microsoft libraries is bundled into one `index.js`.

**D3 · One task, several operations.** `revised` 2026-10-07. Was `mode: whatif | deploy`; now
`operation: whatIf | create | validate | delete`, Microsoft's values. **The default stays
`whatIf`**, where `BicepDeploy@0` defaults to `create`: a step that leaves it out must never
deploy. Rejected: a second task for deploys (a policy could then allow previews and forbid
deploys by task identity, but `BicepDeploy@0` is itself one task, and the parity in `C2` matters
more).

**D4 · Call ARM's REST API directly; no Azure CLI.** The task mints a token from the service
connection and makes its own calls, so another team's agent needs no particular CLI version. Workload
identity federation, a service principal with a secret, and managed identity all work. A
certificate-backed service principal is refused by name: it cannot be tested here, and an auth
path that looks supported and is quietly wrong is worse than one that says so. The sidecar's
`azCliVersion` stays `null` for readers of schema 1.

**D5 · Download a version-pinned Bicep binary and cache it.** ARM accepts only JSON, and Node cannot
compile Bicep. A `bicep` already on `PATH` is ignored, because compiler output changes between
versions. The default `bicepVersion` may move in a minor release of the task, always with a
release note; a consumer who needs one compiler sets it in YAML.

**D6 · Never set `restrictions.commands.mode: restricted`.** `trap` Microsoft recommends it for
production tasks. Restricted mode permits ten logging commands and `addattachment` is not among
them, so it would silently disable the transport this design rests on while the task reports
success. `settableVariables` is not restricted either, because a `create` sets one output
variable per template output, named for the output. Tests assert both.

**D7 · Fan-out stays in the consumer's YAML.** The task does one stack. Looping inside it would
collapse N stages into one job and forfeit per-stack parallelism, `continueOnError`, deploy
gating, and the timeline reconciliation the correctness rule depends on. The task README carries
the reference pattern.

**D8 · Scopes: resource group, subscription, management group.** Added 2026-10-07. Those are
exactly the scopes at which Azure's REST spec (`2025-07-01`) defines stacks and stack what-if
results. `scope` defaults to `subscription`. `subscriptionId` defaults to the connection's (a
deviation: Microsoft requires it). `location` is not needed at resource-group scope. An input set
for a scope that does not use it is ignored with a warning.

**D9 · Three unmanage switches, required where they apply, with no defaults.** Added 2026-10-07.
The CLI's shorthand (`deleteAll`, `deleteResources`, `detachAll`) cannot say "delete resources
and groups, detach management groups", so the task takes `actionOnUnmanageResources`,
`actionOnUnmanageResourceGroups` and `actionOnUnmanageManagementGroups`, each `delete` or
`detach`. The first is required at every scope, the second at subscription and management-group
scope, the third at management-group scope. Microsoft defaults them to `detach`; this task does
not, because a default can be added later and never removed. `denySettingsMode` has no default
for the same reason. Rejected: one switch that the others follow (a `delete` there would silently
delete groups too).

**D10 · Inputs follow `BicepDeploy@0`, with stated exceptions.** Added 2026-10-07.
`ConnectedServiceName` (alias `azureResourceManagerConnection`), `parameters` (inline overrides,
redacted like the file's), `tags`, `validationLevel`, `maskedOutputs`, and a `templateFile` that
may be left out when a `.bicepparam` names its template. Exceptions: `stackName` keeps its name,
because beside `stackId` a bare `name` is ambiguous; there is no `type` (always a stack), no
`environment` (the authority, audience and ARM URL come from the service connection), and no
`whatIfExcludeChangeTypes` (the tab filters in the view; dropping change types from the payload
would hide them). The task's own inputs (`stackId`, `retentionInterval`, `deleteWhatIfResult`,
`resultName`, `layer`, `outputPath`, `publishSummary`) have no Microsoft equivalent.

**D11 · Secrets are resolved before ARM is called, and the compiler's stdout is never streamed.**
`bicep build-params` prints resolved parameter values, secrets included, so its output is
captured rather than handed to a logging exec wrapper. A parameter file whose secrets cannot be
read stops the run while there is still no payload to leak.

**D12 · Both `Node20_1` and `Node24` handlers.** Added 2026-10-07. Node 20 support ends in
April 2026 and the handler is removed in April 2027. Listing both keeps `minimumAgentVersion`
3.232.1 working, because older agents ignore the key they do not know. The task is not marked
`preview`; what is untested (other clouds) is stated in the docs instead.

### E · The tab

**E1 · React 19, without `azure-devops-ui`.** `revised` 2026-10-08. `azure-devops-ui` is
maintained but pinned to `react ^16.8.1`. The tab themes itself against Azure DevOps' CSS custom
properties and follows the host's theme with no theme code of its own. The first design paired
React with TanStack Table and Virtual; both went when rows began opening in place (`E5`), since a
row of unknown height cannot be virtualized cheaply and estates are hundreds of rows, not tens of
thousands. `azure-devops-extension-sdk` is pinned to `^4`, because
`azure-devops-extension-api` peer-depends on `^2 || ^3 || ^4` while the SDK's latest is 5.

**E2 · Severity is the spine.** `revised` 2026-10-08. The first design made severity the sort and
stack only a filter, because grouping by stack in pipeline order buries one `delete` in stack
seven under two hundred `modify` rows in stack one. The tab now opens on one line per stack, but
**ordered by each stack's worst rung**, with its counts per rung on the line before it is opened,
so the guarantee holds by order rather than by dropping the grouping. *All resources* switches to
the flat list ranked across every stack.

**E3 · Reconcile against the Timeline API.** See [03](#the-one-correctness-rule). Revised
2026-10-08: a stage counts if it is named `WhatIf_*` (any case) **or** a what-if attachment traces
to it, and a stage may run several stacks. The prefix is now optional, for one reason: a stage
that never ran leaves nothing else to find, so only its name can put it on screen. Rejected:
detecting stages by the task's GUID, which `create` stages share and which would have had to be
injected into the tab per build. Accepted cost: a `WhatIf_*` stage that runs no what-if shows as
not evaluated.

**E4 · Develop offline against committed fixtures.** `?mock=1` loads the fixtures instead of calling
the SDK, and it ships in the production bundle: it is the fastest way to tell a rendering bug from
a data problem. It proves nothing about the SDK handshake; only an installed build does.

**E5 · Open on a headline, with rows that open in place.** Added 2026-10-08, after a review in a
real organisation found the first layout overwhelming. The host gives the tab a fixed-height
frame, and banners, a chip strip and a toolbar took most of it before the grid began. Now:

- A **headline sentence** says how many stacks would delete or stop protecting resources, how many
  were not evaluated, and whether Azure warned a result may be incomplete. No filter changes it.
- A **totals line** in plain words is also the severity filter. Colour sits on the number only.
- **Stacks that were not evaluated** get their own group, under the risky stacks and above every
  stack that only modifies.
- A **row opens beneath itself**, property changes first as a Property / Before / After table.
  Several can be open at once, and an open row is shown whatever the filters say.
- Filters, layout, open stacks and open rows all live in the URL hash, so a link reproduces the view.

The UX decisions and why three of them changed are in
[`packages/ui/README.md`](../packages/ui/README.md).

### F · Distribution and security

**F1 · The publisher is never committed.** `revised` 2026-10-05. Extension identity is
`{publisher}.{id}`, so changing either creates a different extension with no upgrade path.
`vss-extension.json` names no publisher; packaging refuses to run without an overrides file.
The first design used two publishers, one for development and one for release. Now one publisher,
`MichaelC`, publishes both, separated by extension id: `bicep-whatif` for release, `bicep-whatif-dev`
for development. The dev build also gives the task its own name (`StackWhatIfDev`) and GUID, so dev
and release install side by side. The dev extension is shared only into one test organisation;
sharing it anywhere people rely on creates an install they must later be migrated off.

**F2 · `vso.build` only, and no egress from the tab.** No `build_execute`, `code` or
`serviceendpoint`. Everything is bundled: no CDN, no font host, no telemetry. Keep this claim
distinct from the task's download of Bicep (`D5`), which happens on the consumer's agent, not in a
browser. Scopes that could come later, each forcing every organisation to re-authorize:
`vso.release`, `vso.code`, `vso.work`.

**F3 · Redact by value, not by path.** `trap` The task reads the compiled template's `@secure()`
parameters, takes their values (from the parameters file and from inline `parameters`), and
replaces each one throughout the serialized payload, once, before any sink reads it: the
attachment, the file on disk, the summary, the sidecar's error, the task's result message.
`maskedOutputs` names are masked in the log and redacted from a `create`'s payload. Why by value:
a `@secure()` parameter that flows into a write-only ARM property cannot appear in `before`, but
`after` is computed from the template, so a `create` row carries it. A path denylist misses the
path nobody thought of. Where this has met Azure is in [05](#05--verified-facts).

### G · Deferred

**G1 · Predicted versus actual.** `deferred`, now planned for 1.1 as `G5`. The data is banked
already: `create` attachments have their own types (`B5`), and every sidecar records its request's
correlation id.

**G2 · Shipped YAML templates.** `deferred` A second distribution channel with its own versioning.
The task README's example comes first.

**G3 · Repository-configurable noise rules.** `deferred` Azure's baseline plus `C4` cover 1.0.

**G4 · Offboarding a stack.** `deferred` Out of scope until a stack is actually retired.

**G5 · Report what a deploy actually changed, from Resource Graph.** Added 2026-10-08; 1.1, not
1.0. On a real deploy three signals disagreed: deployment operations called every PUT a create,
the stack what-if reported more `modify` rows than were real, and only Azure Resource Graph's
`resourcechanges`, filtered by the deploy's correlation id, matched what changed. No Microsoft
tool joins the two, so there is nothing to copy. Direction agreed, design open:

- A **roll-up stage after the deploy stages**, not a wait inside each `create`, probably as a
  second task (its name is not decided and is permanent once released).
- It discovers the build's `create` attachments itself, takes each stack's correlation id from the
  stack's `properties.correlationId` (never a response header, which belongs to the last poll),
  waits only as long as rows keep arriving, and runs one Resource Graph query.
- It checks it can see every resource the stack manages, and says "no visibility" rather than "no
  change recorded" where it cannot.
- The tab then sets prediction against record per resource: changed but not predicted (top
  severity), predicted and changed, predicted with no change recorded (never "unchanged"), and
  only volatile properties changed.

Everything here is additive to what `@1` freezes ([06](#06--what-1-freezes)): a new task, a new
attachment type, new sidecar fields.

## 05 · Verified facts

Each changed a decision. Re-check before relying on one months from now.

| Fact | Checked | Consequence |
| --- | --- | --- |
| Stacks and stack what-if results exist at resource group, subscription and management group scope only; stacks also have a `validate` action | REST spec `deploymentStacks.json`, stable `2025-07-01`, 2026-10-07 | `D8`; no tenant scope |
| A what-if result's retention is 1 to 3 hours; `P1D` is rejected at run time | Live runs, 2026-08 | `C3`. Microsoft's documents disagree with the service, and with each other |
| A stack what-if compares the parameter values it is given, not the template's defaults | Smoke run against Azure, 2026-10 | A tag from a `utcNow()` default changed every run and the what-if called it `noChange`; passed as a value, the same change was a `modify`. Pass the values the preview must see |
| A module whose id cannot be known before the deploy is short-circuited: absent from `resourceChanges`, named only in `diagnostics`, with unmatched resources reported as potential `detach` / `delete` | Smoke runs against Azure, 2026-10-08, kept as captures in `core/fixtures/real` | `03`: diagnostics are shown, potential changes marked |
| Enum casing is inconsistent within one payload (`"none"` and `"None"` for the same deny mode) | Real capture | `core` matches enums case-insensitively |
| The property-level `changeType` is a different enum from the resource-level one: it adds `array` and `noEffect`, drops `detach` and `noChange` | ARM spec and real captures | Separate rendering for property changes |
| Redaction on a `create` works at all three scopes: a `@secure()` stand-in in an output reads `***REDACTED***` in the attachment | Smoke, every scope, 2026-10 | `F3` proven where it can be |
| Redaction on a what-if has never been exercised against Azure: at every scope the smoke's stack what-if returned no property values | Smoke, every scope, 2026-10 | The what-if payload is redacted regardless, because real captures do carry property values |
| Restricted command mode permits ten logging commands, and `addattachment` is not one | Microsoft docs | `D6` |
| `supportsTasks` gates the tab on the task being in the definition, not on it having run; no runtime control ([SDK #85](https://github.com/microsoft/azure-devops-extension-sdk/issues/85), open) | 2026-08 | The task must ship (`02`) |
| `bicep-linux-x64` is about 105 MB; the VSIX limit is 50 MB | Bicep releases API | `D5` |
| `PowerShell3` handler is Windows-only | Microsoft docs | `D2` |
| `Node24` handler: first agent 4.265.1; Node 20 end of support April 2026, removal April 2027 | Microsoft docs, 2026-10-07 | `D12` |
| `azure-devops-ui` peers `react ^16.8.1`; `azure-devops-extension-api` 5.276.0 peers the SDK at `^2 \|\| ^3 \|\| ^4` while the SDK's latest is 5.0.0 | npm, 2026-08 | `E1` |
| No Marketplace extension contributes a task named `StackWhatIf` or close to it | Marketplace, 2026-10-07 | Task name confirmed |

## 06 · What `@1` freezes

These are fixed for the life of task major 1. Changing one is a breaking change: a new major, and
every consumer editing their YAML.

| Frozen | Value |
| --- | --- |
| Extension identity | `MichaelC.bicep-whatif` |
| Task name, GUID, contribution id | `StackWhatIf`, `b34d630d-2819-48d6-a62f-9412768de7c5`, `stack-whatif-task` |
| Input names and `operation` values | `D3`, `D9`, `D10` |
| Defaults that exist | `operation: whatIf`, `scope: subscription`, `stackName` defaults to `stackId`. Removing or changing one is breaking |
| Attachment types | `B5` |
| Sidecar field names | `B3`. New fields are additive |

Not frozen, and safe to change later: adding an input; giving a default to an input that has none
(which is why the unmanage switches and `denySettingsMode` have none yet); the default
`bicepVersion`, in a minor release with a release note; anything in the tab.

Packaging refuses an extension major that differs from the task major, so an extension 2.0 forces
task `@2`. Loosening that later breaks no one.

## 07 · Where it stands

As of 2026-10-09:

- **Built:** all four packages, on the `dev` branch until release.
- **Proven against Azure:** every operation at all three scopes, through the smoke pipeline in
  `packages/task/smoke`, on a dev build installed in the test organisation. The harness in
  `packages/extension/harness` proves the tab against committed fixtures, including several
  stacks in one stage and a stage not named `WhatIf_*`.
- **Reviewed:** the tab, in a real organisation, which produced `E5`.
- **Next:** screenshots, then the 1.0.0 release by the process in
  [RELEASING.md](../../RELEASING.md). Then `G5` for 1.1.

Open, and stated rather than hidden:

- **The per-stack "no baseline" badge** (`C4`) was not built. Azure's noise reduction applies only
  to stacks created or updated since the feature shipped, so a stack without a baseline is
  noisier than it will be, with nothing on screen saying why.
- **Redaction on a what-if** has not met Azure (see 05).
- **Clouds other than Azure public** follow the service connection the same way and have not been
  tried.
- **Certificate-backed service connections** are refused, not supported (`D4`).

## 08 · What would invalidate this

**The input schema froze too early.** Every breaking input change is a task major and a YAML edit
for every consumer. `A5` and the input review of 2026-10-07 exist to get the names right once, before
anyone else installs it.

**First impressions land on stacks without a baseline.** Until a stack is deployed once since
Azure's noise reduction shipped, its what-if is noisier than the tool will eventually look, and a
demo on a noisy stack teaches people the tool is noisy.

**What-if is a prediction, not a promise.** It has documented accuracy limits, and stack what-if
inherits every one; `G5` exists because a real deploy showed it. The `detach` and `delete` rows are
both the most valuable output and the ones to check hardest. A tool that makes those rows easier to
read must not also make them easier to trust without looking.
