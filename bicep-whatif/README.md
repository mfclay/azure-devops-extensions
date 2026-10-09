# Bicep What-If for Deployment Stacks

An Azure DevOps extension that renders [Azure Deployment Stacks][stacks] what-if
output for a multi-stack estate — filterable, severity-ranked, and honest about
what it could not evaluate.

> **Status: not yet released.** All four packages are built, and dev builds have
> run every operation against Azure at all three scopes. The first public release
> will be 1.0.0; [RELEASING.md](../RELEASING.md) has the process.

[stacks]: https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks

## The problem

Azure DevOps pipeline summaries forbid JavaScript. `Distributedtask.Core.Summary`
attachments are static HTML — no `<script>`, no external resources. So a pipeline
running what-if across nine deployment stacks produces nine static blobs with no
filter box, no sort, and no cross-stack view. At nine stacks that is annoying. An
estate with one workload stack per client and environment reaches thirty quickly,
and at thirty it is unnavigable.

An extension tab is the only way to get JavaScript onto that page.

## Packages

| Package | State | What it is |
|---|---|---|
| [`packages/core`](packages/core) | **built** | Normalizer and severity model. No UI dependencies. |
| [`packages/task`](packages/task) | **built** | The pipeline task — one Node task (`Node20_1` and `Node24`), `operation: whatIf \| create \| validate \| delete`. |
| [`packages/ui`](packages/ui) | **built** | The build-results tab — a static React 19 SPA. |
| [`packages/extension`](packages/extension) | **built** | The manifest that binds the two into one VSIX. |

```bash
npm install
npm test        # core: 46 · task: 251 · ui: 177 · extension: 17
npm run build   # core, then task, then ui

npm run dev -w @bicep-whatif/ui              # http://localhost:5173/?mock=1
npm run package -w @bicep-whatif/extension   # the VSIX
```

## The idea in one table

Stack what-if reports four axes per resource, and `core` collapses them into a
single ranking:

| Rung | Reached by |
|---|---|
| `destructive` | `delete` |
| `protectionLoss` | `detach`, management status → `notManaged`, deny mode weakening |
| `create` | `create` |
| `modify` | `modify` |
| `unevaluated` | `unsupported`, or a change type this build does not recognise |
| `noChange` | `noChange` |

Change type alone does not capture danger. A resource going `notManaged`, or a deny
mode weakening from `denyWriteAndDelete` to `none`, is a real loss of protection
with no property change at all — and sorted on `changeType` it lands at the bottom
of the table beside two hundred benign no-ops. At a deploy gate the question is
*what will hurt me*, not *what happened in stack 3*.

Details, including why `unevaluated` has to exist: [`packages/core/README.md`](packages/core/README.md).
The whole design, and every decision id the code cites, is in
[`docs/design.md`](docs/design.md).

## The one correctness rule

**Absence of data must never render as absence of change.**

What-if stages run `continueOnError: true`, so a failed stage lands on
`SucceededWithIssues` and produces no attachment at all. A viewer that simply
renders what it received would show eight clean stacks as a safe deploy while the
ninth was never evaluated.

So the tab reconciles against the build Timeline API rather than against the
attachments: every `WhatIf_*` stage in the run gets a row, and attachments join
onto it, one per stack. A stage with no attachment renders as a loud *not
evaluated*, ranked above *no changes*. A stage named otherwise shows only when a
what-if attached to it, because a stage that never ran leaves nothing to find.
`core` carries the same rule inward — anything it could not parse ranks
`unevaluated`, above `noChange`, so a default filter cannot bury it.

Everything else in this design is convenience. This is correctness.

## Constraints that are already decided

Three things are easy to get wrong here, and two of them are traps a dependency
resolver will walk you into:

- **Do not add `azure-devops-ui`.** It is actively maintained (2.278.0, Aug 2026)
  but pinned to `react ^16.8.1`, and the tab is React 19. The decision is React 19
  with no component library, themed against Azure DevOps CSS custom properties.
- **Pin `azure-devops-extension-sdk` to `^4`.** `azure-devops-extension-api@5.276.0`
  peer-deps the SDK at `^2 || ^3 || ^4`, but the SDK's own latest is `5.0.0`.
  Microsoft's two packages disagree. Do not paper over it with `--legacy-peer-deps`.
- **The browser never calls Azure Resource Manager.** Everything runs pipeline-side
  and the tab only reads build attachments. That is why this needs no Entra app
  registration and no tenant admin consent.
- **Never set `restrictions.commands.mode: restricted` on the task.** Microsoft
  recommends it for production tasks, but restricted mode permits ten logging
  commands and `addattachment` is not among them — it would silently disable the
  transport this entire design rests on, with the task still reporting success.
- **Never bundle the Bicep binary.** `bicep-linux-x64` is ~105 MB against a 50 MB
  VSIX limit. The task downloads a version-pinned one at run time and caches it.
- **Never commit a publisher into `vss-extension.json`.** Extension identity is
  `{publisher}.{id}`, so the development-to-release swap would create a different
  extension with no upgrade path. It comes from `tfx --overrides-file`.

## Contributing

Nothing here has a stable API yet. `core` is versioned `0.1.0` and will change.

## Licence

[MIT](LICENSE).
