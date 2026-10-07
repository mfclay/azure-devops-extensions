# `@bicep-whatif/extension`

The Azure DevOps extension manifest: the [tab](../ui) and the [task](../task),
packaged as one VSIX.

```bash
npm run build                    # from the repo root — core, task, then ui
npm run package -w @bicep-whatif/extension
```

That writes `dist/<publisher>.<id>-<version>.vsix` (`MichaelC.bicep-whatif-dev-…` for the dev overrides) and prints its
size against the 50 MB Marketplace limit. Currently **4.08 MB**, of which the
task's two un-bundlable Microsoft libraries are most of it.

## Why the task ships even though the tab is the product

`supportsTasks` on a build-results tab gates visibility on the task being present
**in the build definition** — not on it having run — and there is no runtime
control over whether a tab appears
([SDK issue #85](https://github.com/microsoft/azure-devops-extension-sdk/issues/85),
open). A tab-only extension would therefore appear on every build in the
organisation, including the ones with nothing to show. Shipping the task is what
scopes the tab to the pipelines that produce what it renders.

That also makes the GUID in `supportsTasks` load-bearing: it must equal the `id`
in `task.json`, and a mismatch makes the tab silently never appear, with nothing
logged anywhere. `test/manifest.test.ts` asserts they agree.

Dev builds ship the task as `StackWhatIfDev`, with its own GUID, so a dev build
and a release build can be installed in the same organisation. The `task` block
in `overrides/dev.json` holds that identity; `scripts/package.mjs` writes it into
the staged `task.json` and points `supportsTasks` at it. Pipelines that run
against a dev build reference `StackWhatIfDev@1`.

## The publisher is never committed

Extension identity is `{publisher}.{id}`. Swapping a development publisher for a
release one therefore creates a **different extension** — no upgrade path, no
install continuity, and anyone on the old one has to be migrated by hand.

So `vss-extension.json` names no publisher at all, and packaging refuses to run
without `--overrides-file`:

```bash
npm run package                                          # overrides/dev.json
node scripts/package.mjs --overrides overrides/release.json
```

`overrides/dev.json` is committed and names `MichaelC`, marked `public: false`.
`overrides/release.example.json` is a template that refuses to be used as-is —
copy it, set the version, and keep the copy out of git. The publish workflow
stages the same fields itself (RELEASING.md, "A release").

**Sharing the dev extension into an organisation people rely on, even once,
creates an identity they must later be migrated off.** That is the whole reason the two
are separate.

## Scopes

`vso.build` and nothing else. No `build_execute`, no `code`, no
`serviceendpoint`. Scopes are the most visible thing a reviewer sees at install
time, and *"static SPA, build-read only, no egress"* is an approval story that
survives review.

Keep that claim distinct from the task's: the task downloading a Bicep binary at
run time is a separate thing that happens on your agent under your service
connection, not something the tab does in a browser. Conflating the two invites a
question with no clean answer.

## What goes in the archive

Staged into `build/` first, so the VSIX contains exactly what was staged — no
`node_modules` from a sibling package, no source, no fixtures.

| In the VSIX | From | Addressable |
|---|---|---|
| `task/` | `packages/task/dist` | no — the agent reads it out of the archive |
| `ui/` | `packages/ui/dist` | yes — served to the tab's iframe |
| `images/`, `overview.md`, `LICENSE` | here | yes |

`images/icon-256.png` is the Marketplace icon. The listing shows it at 128 CSS px, so 256 px
keeps it sharp on high-DPI screens. Its source is `art/icon.svg`, which is not packaged;
re-render the PNG from it with any SVG renderer. `art/task-icon.svg`
is the same mark with the glyph enlarged for 32px, rendered to the task's
`packages/task/icon.png`.

## Publishing

[RELEASING.md](../../../RELEASING.md) at the repo root has the whole process: identity, dev
builds, the release steps, credentials and the listing. What is specific to this extension:

- **The dev build gives the task its own identity.** `overrides/dev.json` sets the task's
  GUID and name as well as the extension id, so dev and release can be installed in one
  organisation. `scripts/package.mjs` applies them to the staged copy only.
- **There is no dev publish wrapper yet.** Package with a copy of `overrides/dev.json` that
  sets `"version"`, then publish with `tools/tfx-run`, or run the *Bicep What-If Publish*
  workflow by hand. Never `--rev-version`; RELEASING.md says why.

### The release publish — not yet done

The release will be `MichaelC.bicep-whatif`, published by the steps in RELEASING.md
with `--overrides overrides/release.json`, which is gitignored for the reason in
"The publisher is never committed" above. Until then, the task's markdown summary
(`publishSummary`, on by default) is what a pipeline without the extension
installed still gets. **Never `--share-with` an
organisation people rely on from the dev publisher** — identity is `{publisher}.{id}`, so
even once creates an install people must later be migrated off.
