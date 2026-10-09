# Fixtures

Two kinds, kept in separate directories because they carry very different weight.
`real/` is evidence about how Azure behaves. `synthetic/` is not, and must never be
cited as though it were.

## `real/` — captured payloads

| File | Stack | Resource changes |
|---|---|---|
| `build-7700017-app-network.json` | `app-network` | 7 — 5 `modify`, 2 `noChange` |
| `build-7700017-app-shared-infra.json` | `app-shared-infra` | 4 — 2 `modify`, 2 `noChange` |

There is also one capture that is not an ARM payload at all:

| File | What it is |
|---|---|
| `build-7700078-timeline-and-attachments.json` | An Azure DevOps build timeline and its two what-if attachment lists, plus the nine sidecars — the surface the **results tab** reads, rather than the one the normalizer reads |

### `build-7700078-timeline-and-attachments.json`

Captured from build **7700078** (`contoso/Platform`, pipeline
`deployment-stacks-whatif`, branch `main`, succeeded 2026-08-26) through the Build
REST API: the timeline, the `whatif.stack.json` and `whatif.stack.sidecar`
attachment lists, and each sidecar body.

It exists because `packages/ui/src/data/ado.ts` had never seen a live response.
Everything that module decides offline lives in `join.ts`, and
`packages/ui/test/joinCapture.test.ts` replays this capture through it — so the
`_links.self.href` format, the `Stage` record type and the parent chain are now
checked against what Azure DevOps actually returned rather than against a
hand-built timeline that agrees with the code by construction.

Nine stacks across all five layers, which is the first multi-layer fixture in the
repo. It also carries nine `Deploy_*` stages, a `DetectChanges` stage and a
`WhatIfRollup` stage, all of which the tab has to *exclude* — and one thing no
hand-built timeline had shown: the **`Phase` and `Job` records beneath each stage
inherit a `WhatIf_*` identifier** (`WhatIf_Network.WhatIf`,
`WhatIf_Network.WhatIf.__default`). Twenty-seven records match the prefix and only
nine are stages, so `isWhatIfStage`'s `type === 'Stage'` test is load-bearing.

Two departures from the raw response, both deliberate:

- **The timeline records are projected** to the seven fields `TimelineRecordLike`
  declares — `id`, `parentId`, `type`, `name`, `identifier`, `state`, `result`.
  Values are verbatim; nothing was invented or reordered. The full records carry
  timestamps, log URLs, change ids and worker names that the join never reads, and
  keeping them would have quadrupled the file and the scrub surface for no
  evidential gain.
- **The attachment lists and sidecars are verbatim**, because those are precisely
  the shapes that were unverified.

Captured from Azure DevOps build **7700017** (`contoso/Platform`, a what-if
pipeline over two stacks, succeeded 2026-08-26), from the published artifacts `whatif-network-1` and
`whatif-shared-infra-1`. They are the whole SDK resource as
`az stack-whatif ... --no-pretty-print` returns it.

### These are scrubbed, and here is exactly how

They are captures of real pipeline runs, and this repo is public. Identifiers were
substituted by `tools/scrub-fixture.mjs`; nothing else was touched.

The real values are deliberately **not** listed here — a table pairing each
substitution with its original would republish everything the scrub removed.

| What was replaced | Committed as | Why |
|---|---|---|
| The subscription id | `00000000-0000-4000-8000-000000000001` | A live subscription id is the most useful thing in a leaked ARM payload |
| Three further GUIDs — correlation, tenant, principal | `…0002` – `…0004` | Identify the tenant and the service principal behind the run |
| One **routable public address**, sitting in a container-registry firewall allowlist | `203.0.113.1` | It is a real egress IP. RFC 5737 TEST-NET-3 exists for exactly this |
| Three RFC1918 private ranges | second octet remapped | Unroutable, but still discloses internal subnet layout. Only the second octet moves, so CIDR containment survives — a `/28` inside a `/24` is still inside it |

To see the mapping for a given run, read the report `tools/scrub-fixture.mjs`
prints. It goes to stdout and is not committed.

Property values and structure are **unchanged**, so these still read like the
pipeline output people debug against. Names are fictitious (`contoso`,
`Platform`, `alpha`, `regx`/`regy`, `app-*`) and consistent across files, so every
cross-reference and CIDR containment still holds.

The substitution was verified structure-preserving: a full structural fingerprint
of each scrubbed file (every key, every container shape, values erased) is
identical to the raw capture, and the `changeType` tallies match. A scrubbed
fixture therefore exercises the normalizer exactly as the raw capture would.

**Re-scrub every fixture in one invocation.** Mappings are assigned in first-seen
order and shared across the files in a single run; scrubbing them separately would
give the same subscription two different fake ids and break cross-references.

### When a later harvest cannot join that invocation

That rule assumes every raw capture is still to hand. It stops being possible the
moment a fixture is committed, because the raw form is deliberately not kept — so a
harvest done later can only be scrubbed on its own, and on its own it would restart
numbering at `…0001` and silently reuse ids that already mean something else.

`build-7700078-timeline-and-attachments.json` is the first fixture in that
position, and `tools/scrub-fixture.mjs` grew two flags for it:

```bash
node tools/scrub-fixture.mjs packages/core/fixtures/real \
  --seed <real-subscription-id>=00000000-0000-4000-8000-000000000001 \
  --start 101 \
  /path/outside/the/repo/build-7700078-timeline-and-attachments.json
```

- `--seed` holds an identifier to the id it already has in a committed fixture. The
  subscription in this capture was **verified to be the same** as the one in the
  7700017 payloads — by downloading build 7700017's raw artifact and comparing —
  so it keeps `…0001` rather than collecting a second id. A seed that matches
  nothing is a hard error that writes no files, because a mistyped seed otherwise
  fails silently in exactly the way seeding exists to prevent.
- `--start 101` puts everything genuinely new in a disjoint range, so no number in
  this file can be mistaken for `…0002`–`…0004` in the payload fixtures. This
  capture's own GUIDs run `…0101`–`…0247`.

Run it from outside the repo: `--seed` carries a real identifier on the command
line, and the scrub report goes to stdout and is not committed.

### What these fixtures cannot tell you

- **No `Detach` and no `Delete`.** No live stack in the estate produces either, so
  the two most severe rungs of the ladder have no captured example. That is what
  `synthetic/` is for.
- **Only two stacks' payloads.** The normalizer takes N stacks and is exercised
  against two. This was previously blocked on an estate rebuild; it is not any
  more — build 7700078 evaluated **nine** stacks across all five layers, and its
  timeline capture is committed here. What is still missing is nine captured
  *payloads*, which is now only a harvest, not a dependency.
- **Every stack here is un-baselined**, so the payloads are noisier than the tool
  will eventually look.

## `synthetic/` — hand-authored

**Not captured. Not evidence about Azure.** Written against the
`deploymentStacks/stable/2025-07-01` swagger, with field names, casing and nesting
copied from the real captures so the parser sees an identical shape. Each file
carries a `_synthetic` block at the top saying so; the normalizer ignores it.

| File | Covers |
|---|---|
| `synthetic-destructive-and-protection-loss.json` | `delete`, `detach`, `create`, `unsupported`, plus the two axes that carry no change type — a `noChange` resource going `notManaged`, and a `modify` whose deny mode weakens |
| `synthetic-schema-drift.json` | An unrecognised resource `changeType`, an unrecognised property `changeType`, an unrecognised deny status, a resource with no id, a resource with no change type, and a `delta` that is not an array |
| `synthetic-short-circuit.json` | A stack what-if that short-circuited, shaped on one run against Azure: the `ShortCircuitedResourceId` warning, an `unsupported` row whose id is the unevaluated expression, and invented `potential` changes. Its `_synthetic` block says which parts came from the run |
| `synthetic-stage-app-frontend.json`, `synthetic-stage-app-backend.json` | Two small, unremarkable stacks for the harness stage that attaches two stacks |
| `synthetic-stage-monitoring.json` | One small stack for the harness stage not named `WhatIf_` |

The three `synthetic-stage-*` files exist for the harness pipeline, not the normalizer.
Their stack names and resource ids appear in no other fixture, so the tab cannot merge
them with another stage's rows.

These prove how the **normalizer** behaves when ARM says these things. They prove
nothing about whether ARM says them.

## Harvesting more

Find a run first. Ask for the ids as JSON — `-o table` drops the `id` column.

```bash
az pipelines runs list --org https://dev.azure.com/<org> --project <project> \
  --top 200 \
  --query "[?contains(definition.name,'stacks-whatif')].{id:id,branch:sourceBranch,result:result}" -o json
```

### Payloads, from the published artifacts

```bash
az pipelines runs artifact download --org https://dev.azure.com/<org> \
  --project <project> --run-id <id> --artifact-name whatif-<stackId>-<attempt> --path ./raw

node tools/scrub-fixture.mjs packages/core/fixtures/real ./raw/*.json
```

### Timeline and attachments, for the tab

A different API surface, and the one to use for anything about
`packages/ui/src/data/`. Attachments are **not** published artifacts: they are
filed by the task with `##vso[task.addattachment]` and only reachable through the
Build REST API.

```bash
# The timeline — every stage in the run, including the ones that attached nothing.
az devops invoke --org https://dev.azure.com/<org> --area build \
  --resource timeline --route-parameters project=<project> buildId=<id> \
  --api-version 7.1 -o json

# The attachment list, one call per type: whatif.stack.json and whatif.stack.sidecar.
az devops invoke --org https://dev.azure.com/<org> --area build \
  --resource attachments --route-parameters project=<project> buildId=<id> \
  type=whatif.stack.json --api-version 7.1 -o json

# One attachment's body. timelineId and recordId come out of the list entry's
# _links.self.href — the list carries them nowhere else. The response is not
# served as JSON, so --out-file is required and -o json fails.
az devops invoke --org https://dev.azure.com/<org> --area build \
  --resource attachments --route-parameters project=<project> buildId=<id> \
  timelineId=<timelineId> recordId=<recordId> type=whatif.stack.sidecar name=<stackId> \
  --api-version 7.1 --out-file ./raw/<stackId>.json
```

A build that predates the attachment work returns `count: 0` rather than an error,
so check the count before concluding the shape changed.

### Either way

Re-read the scrub report it prints and confirm no routable address survived, then
run `npm run check:identifiers`. **That guard reads `git ls-files`**, so a fixture
has to be `git add`ed before it is scanned at all — a clean report on an untracked
file means nothing was checked.
