# Harness

A pipeline that produces what the tab reads, without producing it for real.

The tab never checks what created an attachment. It asks Azure DevOps for every
attachment of type `whatif.stack.json` on a build, reads them back, and
reconciles them against the build timeline. So a pipeline that attaches a
committed fixture is, from the tab's side, indistinguishable from one that spent
two minutes talking to ARM.

That is what this is for. It exercises the parts of the tab that no test can
reach — the SDK handshake, `getAttachments`, the `_links.self.href` parsing, the
timeline join, the rendering — with **no Azure subscription and no deployment
stacks.**

It does need one thing it used to claim it did not: **a placeholder Azure
Resource Manager service connection.** Not because anything uses it — nothing
does — but because `azureSubscription` is `required: true` and typed
`connectedService:AzureRM` in `task.json`, so the disabled `StackWhatIfDev@1` step
cannot omit it, and `supportsTasks` means the step cannot be removed either. See
"Setting it up", step 2.

## What it is not

Evidence about Azure. Every payload here is a fixture from
[`packages/core/fixtures`](../../core/fixtures), and every sidecar this harness
writes carries `"producer": "harness"`, so a harness run can never be mistaken
for a real one — in the tab or in a screenshot of it.

## Setting it up

**This repo is on GitHub; pipelines run in Azure DevOps.** Those are two
different hosts, and bridging them is a deliberate step rather than an implied
one — Azure Pipelines can build a GitHub-hosted repo, but only once you have
authorised it against the GitHub account. Read "Which organisation" below before
doing it.

In an Azure DevOps organisation you control:

1. **Install the extension first.** Publish privately from this repo, then share
   it to your organisation and install it. See
   [the extension README](../README.md#publishing) — publishing needs a
   Marketplace PAT, which is yours to create.

   Order matters: the pipeline references `StackWhatIfDev@1`, the dev build's
   name for the task, so if the extension
   is not installed the YAML fails to validate the moment you save it, with an
   error about an unrecognised task rather than anything about the harness.

2. **Create the placeholder service connection.** Project settings → Service
   connections → New service connection → **Azure Resource Manager** →
   **Service principal (manual)**.

   Every credential field can be junk — all-zero GUIDs, any key — because
   nothing ever authenticates with it. **Do not verify it**; verification is
   supposed to fail. Save it as **`harness-placeholder-connection`**, matching
   the name in `azure-pipelines.yml` exactly, and tick **Grant access
   permission to all pipelines**.

   That checkbox matters as much as the name. A connection that exists but is
   not authorised fails validation the same way one that does not exist at all
   does, and the error points at `aka.ms/yamlauthz` rather than saying so.

3. **Create the pipeline.** Pipelines → New pipeline → **GitHub**. The first
   time, this authorises Azure Pipelines against your GitHub account and asks
   you to install the Azure Pipelines GitHub App.

   **Choose "Only select repositories" and pick this repo.** The default is
   every repository on the account, which is a far wider grant than this needs.
   You can review or revoke it later at GitHub → Settings → Applications →
   Installed GitHub Apps → Azure Pipelines.

4. **Point it at the file.** *Configure your pipeline* → **Existing Azure
   Pipelines YAML file** → branch `main`, path
   `/bicep-whatif/packages/extension/harness/azure-pipelines.yml`.

5. **Run it.** Six stages, all green in about a minute. Open the build's
   **What-If** tab.

Nothing else needs configuring — no variables, and no service connection beyond
the placeholder in step 2. The pipeline is `trigger: none` and `pr: none`, so
connecting the repo does **not** mean GitHub pushes start queueing builds; it
only ever runs when you ask.

### Which organisation

Use a test organisation **you own**, not one other people work in.

Connecting it to GitHub adds no SSH key, changes no commit authorship, and needs
no `gh` login. It is still a new account-level grant, which is worth making
deliberately.

The same reasoning is why the dev extension is shared only into that test
organisation — see decision F1 in
[the extension README](../README.md#the-publisher-is-never-committed).

### If you would rather not connect GitHub at all

The harness needs no source from this repo — only the fixtures and
`attach-fixture.mjs`, which is six files and about 112 KB. Copying those into a
small Azure Repos repo in your own organisation keeps everything inside Azure
DevOps and adds no GitHub grant at all. The cost is that the fixtures then exist
in two places and can drift, which is mild here because they are static evidence
rather than code. Fixture paths in `azure-pipelines.yml` would need flattening to
match the new layout.

## A brand-new organisation has no agent to run this on

The first run in a fresh organisation fails every stage at once with:

> No hosted parallelism has been purchased or granted.

That is not the harness. Microsoft-hosted agents used to come with a free
parallel job for private projects; new organisations now get **zero** until the
grant is requested, because the free tier was being mined for crypto. Nothing in
the pipeline can work around it — there is no agent to run on.

Two ways out, and they are not equivalent:

- **Request the free grant** at
  [aka.ms/azpipelines-parallelism-request](https://aka.ms/azpipelines-parallelism-request).
  Free, permanent, and the right answer — but it is a human-reviewed form and
  takes a few business days. Nothing runs in the meantime.

- **Register a self-hosted agent**, which works immediately and costs nothing.
  It suits this harness unusually well: every stage does nothing but run
  `node attach-fixture.mjs` against committed fixtures, so the agent needs Node
  and a git checkout and no Azure anything. A laptop is a perfectly good agent
  for it.

  This needs a one-line change, because the pipeline pins the Microsoft-hosted
  image:

  ```yaml
  pool:
    vmImage: ubuntu-latest     # Microsoft-hosted — needs the parallelism grant
  ```
  ```yaml
  pool:
    name: <your-agent-pool>    # self-hosted — works with no grant
  ```

  Agent setup is Project settings → Agent pools → Add pool → New agent, and the
  download page scripts it. The PAT it asks for needs **Agent Pools (read,
  manage)** and is used once at registration.

Either way this is an organisation-level prerequisite, not a step in "Setting it
up" — it is done once per organisation and then never thought about again.

## What you should see

Six stacks, spanning the cases that matter:

| Stage | Shows |
|---|---|
| `WhatIf_Network` | A real capture — 7 resource changes, layer 1 |
| `WhatIf_SharedInfra` | A real capture — 4 resource changes, layer 2 |
| `WhatIf_Destructive` | `delete` and `detach`, plus a weakened deny mode — the severe rungs no real capture in this repo contains |
| `WhatIf_SchemaDrift` | Change types and a `delta` the parser has never seen |
| `WhatIf_Failed` | A sidecar with `status: failed` and **no payload** |
| `WhatIf_NeverEvaluated` | **Nothing attached at all** |

The last two are the point of the whole design, and they must not look alike:

- **`WhatIf_Failed`** attached a sidecar, so the tab knows the stack was looked
  at and could not be evaluated. It must not read as "no changes".
- **`WhatIf_NeverEvaluated`** attached nothing. It exists in the timeline and
  nowhere else, and it must still reach the screen ranked `unevaluated` rather
  than vanish. A stage that disappears here is the bug the join is built to
  prevent — eight clean stacks reading as a safe deploy while the ninth was never
  looked at.

**Both hold.** Verified 2026-08-26 against a real installed extension: the tab
reported *"6 stacks · 2 without results · 23 resources"* and named both
result-less stacks in a banner reading *"2 stacks were not evaluated. They
produced no what-if result, so nothing is known about them — treat that as
unknown, not as unchanged."* Six stages in the timeline, four payloads, five
sidecars, and nothing silently dropped.

## If the tab does not show up

Almost certainly `supportsTasks`, not the handshake.

The tab is only visible when the `StackWhatIfDev` task is present in the build
**definition** — not when it has run. There is no runtime control over whether a
tab renders ([SDK issue #85](https://github.com/microsoft/azure-devops-extension-sdk/issues/85),
open), and the failure is silent: no tab, no error, nothing logged anywhere.

`WhatIf_Network` carries a `StackWhatIfDev@1` step with `condition: false` for
exactly this reason, and **it works** — settled 2026-08-26 against a real
installed extension. A step that never runs still counts as being in the
definition, the tab appears, and the fallback of dropping the condition is not
needed. This paragraph used to hedge; it no longer has to.

**What `condition: false` definitely does not do is skip validation.** The
condition governs runtime only; the step's inputs are resolved when the pipeline
is queued. A missing or unauthorised `harness-placeholder-connection` therefore
fails the whole run before a single stage starts, with an error naming
`azureSubscription` and pointing at `aka.ms/yamlauthz`. If you see that, the
problem is step 2 of "Setting it up", not `supportsTasks` and not the handshake.

Two other things worth checking before digging deeper:

- The extension must be **installed** in the organisation, not merely shared to
  it. Sharing makes it available; installing is a separate click.
- After republishing, the org picks up the new version within a minute or so. A
  stale-looking tab is usually browser cache — hard-refresh before assuming the
  build did not take.

## Adding a stack

Name the stage `WhatIf_*` — the tab finds its stages by that prefix off the
timeline — and call the script:

```yaml
- stage: WhatIf_Example
  displayName: 'Stack 7 — Example'
  dependsOn: []
  jobs:
  - job: WhatIf
    steps:
    - script: node bicep-whatif/packages/extension/harness/attach-fixture.mjs --stack example --layer 3 --payload $(REAL)/some-fixture.json
      displayName: 'Attach: whatever this demonstrates'
```

`attach-fixture.mjs` takes `--stack`, and optionally `--payload` (a path relative
to the repo root), `--layer`, `--status` and `--error`. Omit `--payload` for the
sidecar-only case. Run it locally to see what it would emit — outside a pipeline
the logging commands are inert text:

```bash
node packages/extension/harness/attach-fixture.mjs --stack network --layer 1 \
  --payload packages/core/fixtures/real/build-7700017-app-network.json
```

Quote the whole `script:` value if any argument contains a colon; unquoted, YAML
ends the scalar there and you get a parse error rather than a wrong value.
