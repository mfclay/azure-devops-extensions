# `@bicep-whatif/task`

The pipeline task: compiles a Bicep stack template, previews, creates,
validates or deletes the deployment stack through ARM, redacts what comes back,
and files it as a build attachment. The [tab](../ui) reads back the what-if
ones.

```bash
npm test -w @bicep-whatif/task       # 251 tests
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

## Where redaction has met Azure

**On a `create`, proven.** Each smoke template outputs a `@secure()` stand-in
inside a longer string, unmasked, and the smoke fails unless the attached payload
reads `echo:***REDACTED***|<build id>`. It has passed at all three scopes. Names
in `maskedOutputs` were masked in the log and absent from the payload.

**On a what-if, never exercised.** At every scope, created or modified, the
smoke's stack what-if returned no property values at all, so the stand-in never
reached a what-if payload. The captures in
[`core/fixtures/real`](../core/fixtures/real) do carry property values, which is
why the what-if payload is redacted all the same.

## Inputs

Every input is in [`task.json`](task.json) with help text. The ones worth
explaining here:

- **`stackId` and `stackName` are different tokens.** `stackId` is the logical id
  (`network`) and becomes the attachment name — the tab's filter key. `stackName`
  is the Azure resource name (`app-network`). They are usually related by
  a prefix, and conflating them makes the attachment name disagree with what the
  tab looks for. `stackName` defaults to `stackId`.
- **The `actionOnUnmanage*` switches and `denySettingsMode` are inputs to
  what-if, not just to the deploy.** A preview that ran with different values
  than the deploy it previews is a lie, most obviously about whether a dropped
  resource is reported as `Detach` or as `Delete`. One task with an `operation`
  input is what makes that parity structural rather than documented.
- **`scope` is `resourceGroup`, `subscription` (the default) or
  `managementGroup`**, the three scopes a stack can live at. `resourceGroupName`
  and `managementGroupId` are required at their own scope. `subscriptionId`
  defaults to the service connection's. `location` is required except at
  resource-group scope, where the stack takes its group's location. An input
  set for a scope that does not use it is ignored with a warning.
- **The unmanage switches have no defaults, and each is required where the
  scope can use it.** `actionOnUnmanageResources` always;
  `actionOnUnmanageResourceGroups` at subscription and management-group scope;
  `actionOnUnmanageManagementGroups` at management-group scope.
- **`templateFile` can be left out when `parametersFile` is a `.bicepparam`**,
  whose `using` names the template.
- **`parameters` takes inline values as a JSON object**, name to plain value, laid
  over the parameters file's. A `.bicepparam` receives them while it compiles, as
  `BicepDeploy@0` passes them, so a value the file derives from an overridden one
  follows the override. A `@secure()` parameter set inline is redacted like one
  from the file; pass its value from a secret variable.
- **A stack what-if compares the parameter values it is given, not the
  template's defaults.** Seen against Azure: a tag fed from a `utcNow()`
  parameter default changed on every run, and the what-if still called it a
  definite `noChange`; passed in as a parameter value, the same change was a
  `modify`. A change that comes only from a default can be missing from the
  preview, so pass values the preview must see.
- **`tags` go on the what-if result as well as the stack.** The result is a
  resource too, and a policy that requires a tag would deny it otherwise.
- **`operation` is `whatIf`, `create`, `validate` or `delete`, and defaults to
  `whatIf`**, not to `create` as `BicepDeploy@0`'s does: a step that leaves it out
  never deploys. Each attaches a sidecar; `whatIf` files the pair the tab reads,
  the others `whatif.stack.<operation>.json` and `.sidecar`. A `delete` compiles
  nothing and attaches no payload, because ARM returns none. An input set for an
  operation that does not use it is ignored with a warning, unless it holds
  `task.json`'s default, which the agent fills in whether or not it was set.
- **A `create` sets every template output as an output variable**, named for the
  output, as `BicepDeploy@0` does: `$(<step name>.<output>)` in later steps. An
  object or array output is set as its JSON. Names in `maskedOutputs` are masked
  in the log and redacted from the attached payload, which carries the outputs
  too.
- **`retentionInterval` maxes out at `PT3H`.** The service enforces one to three
  hours and rejects `P1D` at run time. Both Microsoft documents are wrong about
  this, in opposite directions.
- **`bicepVersion` is pinned.** A `bicep` already on `PATH` is deliberately
  ignored: compiler output changes across versions, and every consumer's what-if
  should compile identically. The default may move in a minor release of the
  task, always with a release note; set `bicepVersion` in your YAML to stay on
  one compiler.

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
        operation: whatIf
        azureResourceManagerConnection: 'My ARM Connection'
        stackId: network
        stackName: app-network
        templateFile: '$(STACKS)/bicep/stacks/01-network-stack.bicep'
        parametersFile: '$(STACKS)/params/network.bicepparam'
        location: CentralUS
        actionOnUnmanageResources: $(NETWORK_ACTION_ON_UNMANAGE)
        actionOnUnmanageResourceGroups: detach
        denySettingsMode: $(NETWORK_DENY_SETTINGS_MODE)

- stage: WhatIf_SharedInfra
  displayName: 'Stack 2 — Shared Infrastructure'
  dependsOn: []
  # …the same block, with stack 2's values.
```

Name the stages `WhatIf_*` so the tab shows them even when they never ran: it
reads that prefix off the build timeline, and a skipped stage leaves nothing else
to find. A stage named otherwise is shown when a what-if attaches to it, and a
stage may run several stacks. The tab does **not** join attachments to
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

The sign-in authority, token audience and Resource Manager URL all come from the
service connection, so there is no `environment` input. The task is tested on
Azure public cloud only; other clouds follow the connection the same way, but
none has been tried.

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

## Version 1 freezes the inputs

Input names, `operation` values and attachment types are fixed for the life of
`@1`. Renaming or removing any of them is a breaking change: a task major, and
every consumer editing their YAML to pick it up. Adding an input is not, and
neither is giving a default to one that has none, which is why the unmanage
switches and `denySettingsMode` have none yet. Removing a default would be.

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
| `src/request.ts` | The ARM request bodies, built from one input set. |
| `src/redact.ts` | Secure-value discovery and by-value redaction. |
| `src/outcome.ts` | Did it succeed? The judgement the sidecar records. |
| `src/sidecar.ts` | The manifest, for every operation. |
| `src/summary.ts` | Log and markdown roll-up, via `core`'s severity. |
| `src/ids.ts` | Names, scope-aware ARM paths and resource ids. |
| `src/arm/` | Token acquisition, a small REST client, each operation's lifecycle. |
| `src/bicep/` | Which binary, fetching it, running it. |
| `src/attach.ts` | Write, then `##vso[task.addattachment]`. |
| `scripts/bundle.mjs` | Produces the shipped task folder. |
| `smoke/azure-pipelines.yml` | Any operation at any scope against Azure, to prove the task and a service connection. |

Everything except `index.ts`, `arm/client.ts`'s socket use, and `bicep/tool.ts`
is pure. That is not ceremony: a pipeline task can only be exercised end to end
inside a pipeline, so the alternative to injection is no test at all for the
sequencing that matters most.
