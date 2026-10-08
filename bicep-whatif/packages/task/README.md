# `@bicep-whatif/task`

The pipeline task: compiles a Bicep stack template, runs deployment-stack
what-if against ARM, redacts the response, and files it as a build attachment
the [tab](../ui) reads back.

```bash
npm test -w @bicep-whatif/task       # 144 tests
npm run build -w @bicep-whatif/task  # typecheck, bundle, install externals
```

`npm run build` produces `dist/` — the task folder as an agent expects to find
it: `task.json`, one bundled `index.js`, and the two Microsoft libraries that
cannot be bundled. [`packages/extension`](../extension) packages that into the
VSIX.

## What it needs on the agent

Nothing beyond Node. It talks to Azure Resource Manager's REST API directly rather
than through the Azure CLI, and compiles Bicep with a version-pinned binary it
downloads at run time and caches, so the result does not depend on whichever CLI
or Bicep version an agent happens to have.

## The rule this task exists to uphold

**A sidecar is written on every path out of the task**, including the ones that
threw before there was a payload at all — a compiler failure, a bad service
connection, ARM refusing the request.

A consumer has to be able to tell *"evaluated, found no changes"* from *"never
evaluated"*, and an absent sidecar cannot distinguish either of those from a
stage that was skipped. What-if stages run `continueOnError: true`, so the
failure mode is real and quiet: the stage lands on `SucceededWithIssues` and a
tab that trusted the attachment list would show eight clean stacks as a safe
deploy while the ninth was never looked at.

`test/run.test.ts` covers that guarantee at every failure point, and the
`##vso[task.addattachment]` call is why
`restrictions.commands.mode: restricted` must never be set — see the traps.

## Order of operations

Three orderings are load-bearing and are not incidental to how the code reads:

1. **Secure values are resolved before ARM is called.** A parameter file whose
   secrets cannot be read stops the run while there is still no payload to leak,
   rather than after one exists. `secureValuesFrom` fails *closed*: a template
   with no parameters block throws rather than returning "no secrets here".
2. **Redaction happens once, on the serialized payload.** Every sink downstream
   — the attachment, the file on disk, the summary, the sidecar's error field,
   the task's own result message — reads the redacted object. Redacting per sink
   would leave the next sink someone adds unprotected by default.
3. **The what-if result is deleted in a `finally`,** and a failure to delete it
   never replaces the result it was cleaning up after.

## Inputs

Every input is in [`task.json`](task.json) with help text. The ones worth
explaining here:

- **`stackId` and `stackName` are different tokens.** `stackId` is the logical id
  (`network`) and becomes the attachment name — the tab's filter key. `stackName`
  is the Azure resource name (`app-network`). They are usually related by
  a prefix, and conflating them makes the attachment name disagree with what the
  tab looks for. `stackName` defaults to `stackId`.
- **`actionOnUnmanage` and `denySettingsMode` are inputs to what-if, not just to
  the deploy.** A preview that ran with different values than the deploy it
  previews is a lie, most obviously about whether a dropped resource is reported
  as `Detach` or as `Delete`. One task with a `mode` input is what makes that
  parity structural rather than documented.
- **`retentionInterval` maxes out at `PT3H`.** The service enforces one to three
  hours and rejects `P1D` at run time. Both Microsoft documents are wrong about
  this, in opposite directions.
- **`bicepVersion` is pinned.** A `bicep` already on `PATH` is deliberately
  ignored: compiler output changes across versions, and every consumer's what-if
  should compile identically.

## Fan-out belongs in your YAML

The task does one stack. Looping inside it would collapse N stages into one job
and forfeit per-stack parallelism, `continueOnError`, deploy gating, and the
timeline reconciliation the correctness rule depends on. So the pattern is one
stage per stack:

```yaml
- stage: WhatIf_Network
  displayName: 'Stack 1 — Network'
  dependsOn: []
  jobs:
  - job: WhatIf
    steps:
    - task: StackWhatIf@1
      displayName: What-If
      continueOnError: true
      inputs:
        mode: whatif
        azureSubscription: 'My ARM Connection'
        stackId: network
        stackName: app-network
        templateFile: '$(STACKS)/bicep/stacks/01-network-stack.bicep'
        parametersFile: '$(STACKS)/params/network.bicepparam'
        location: CentralUS
        actionOnUnmanage: $(NETWORK_ACTION_ON_UNMANAGE)
        denySettingsMode: $(NETWORK_DENY_SETTINGS_MODE)

- stage: WhatIf_SharedInfra
  displayName: 'Stack 2 — Shared Infrastructure'
  dependsOn: []
  # …the same block, with stack 2's values.
```

Name the stages `WhatIf_*`; the tab reads that prefix off the build timeline to
decide which stages it is responsible for. It does **not** join attachments to
stages by matching the stage id against the stack id — it walks the timeline's
parent chain — so the two naming schemes are free to disagree, which is just as
well because they are maintained by hand in separate files.

A stack id is not needed for the sidecar's `layer`: a leading number on the
template file name (`05-workload-stack.bicep`) supplies it.

### Service connections

Workload identity federation, service principal with a secret, and managed
identity all work, with nothing to add to the step. Workload identity federation
asks Azure DevOps to mint an OIDC assertion using the job's own access token, which
the agent gives every task as the `SYSTEMVSSCONNECTION` endpoint, so there is no
`SYSTEM_ACCESSTOKEN` to map into `env:`.

## Traps

1. **Never set `restrictions.commands.mode: restricted` in `task.json`.**
   Microsoft recommends it for production tasks. Restricted mode permits ten
   logging commands and `addattachment` is not among them — it would silently
   disable the mechanism this entire design rests on, with the task still
   reporting success. `test/manifest.test.ts` asserts it is unset.
   Constraining `settableVariables` is still worth doing and keeps most of the
   posture; that is set to an empty allowlist.

2. **Never bundle the Bicep binary.** `bicep-linux-x64` is ~105 MB against a
   50 MB VSIX limit — measured against the releases API, not estimated. It is
   downloaded and cached at run time through `azure-pipelines-tool-lib`, and
   skipped entirely when the template is already ARM JSON.

3. **The compiler's stdout is captured, never streamed.** `bicep build-params`
   writes *resolved* parameter values to stdout, which for a `@secure()`
   parameter is the secret itself. Handing that to a logging exec wrapper would
   publish it to the build log before redaction has anything to work with. This
   is why `bicep/tool.ts` uses `execFile` rather than the task library's exec.

4. **Do not add `actionOnUnmanage`, `denySettings` or `retentionInterval` to the
   sidecar.** The what-if result echoes all three back in its own `properties`
   and the tab reads them from there. The omission exists to prevent a
   disagreement between two records of the same thing.

5. **Severity is not re-implemented here.** `@bicep-whatif/core` owns the
   four-axis collapse, and sharing it is the entire payoff of running TypeScript
   on Node (`Node20_1` and `Node24`). The log summary calls the same
   `severityOf` the tab does, so the two cannot rank a run differently.

6. **`azure-pipelines-task-lib` and `azure-pipelines-tool-lib` stay external to
   the bundle.** The task library resolves its own string resources relative to
   its own `__dirname`; bundling it moves that directory and the lookups fail at
   run time, in the logging path.

7. **The task version is stamped into every sidecar** as `producer`, and the
   bundler refuses to build if `task.json` and `package.json` disagree about it.

## Version 0.x is deliberate

Going fat means any breaking input change is a task major-version bump that every
consumer has to edit their YAML to pick up. `0.x` says the input schema is not
frozen. Treat `1.0.0` as freezing the input *names* the moment anyone outside
this repo installs it.

## Certificate service connections

A service principal that authenticates with a certificate is refused by name
rather than attempted. Signing a client assertion is not hard, but this task
cannot verify it without a certificate-backed connection to test against, and an
auth path that looks supported and is quietly wrong is worse than one that says
what it is. If it is ever needed, `@azure/msal-node` signs the assertion directly.

## Layout

| Path | What it does |
|---|---|
| `src/index.ts` | The only file that knows Azure Pipelines exists. |
| `src/run.ts` | Orchestration, with every side effect injected. |
| `src/inputs.ts` | Raw inputs → validated, reporting every problem at once. |
| `src/request.ts` | The two ARM bodies, built from one input set. |
| `src/redact.ts` | Secure-value discovery and by-value redaction. |
| `src/outcome.ts` | Did it succeed? The judgement the sidecar records. |
| `src/sidecar.ts` | The manifest, for both modes. |
| `src/summary.ts` | Log and markdown roll-up, via `core`'s severity. |
| `src/arm/` | Token acquisition, a small REST client, the two lifecycles. |
| `src/bicep/` | Which binary, fetching it, running it. |
| `src/attach.ts` | Write, then `##vso[task.addattachment]`. |
| `scripts/bundle.mjs` | Produces the shipped task folder. |
| `smoke/azure-pipelines.yml` | One real what-if against Azure, to prove a service connection. |

Everything except `index.ts`, `arm/client.ts`'s socket use, and `bicep/tool.ts`
is pure. That is not ceremony: a pipeline task can only be exercised end to end
inside a pipeline, so the alternative to injection is no test at all for the
sequencing that matters most.
