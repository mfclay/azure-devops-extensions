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

## The publisher is never committed

Extension identity is `{publisher}.{id}`. Swapping a development publisher for a
release one therefore creates a **different extension** — no upgrade path, no
install continuity, and anyone on the old one has to be migrated by hand.

So `vss-extension.json` names no publisher at all, and packaging refuses to run
without `--overrides-file`:

```bash
npm run package                                          # overrides/dev.json
node scripts/package.mjs --overrides overrides/release.json
node scripts/package.mjs --rev-version                    # bump the patch first
```

`overrides/dev.json` is committed and names `MichaelC`, marked `public: false`.
`overrides/release.example.json` is a template that refuses to be used as-is —
copy it, fill in the publisher, and keep the copy out of git.

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

`images/icon-128.png` is the Marketplace icon. Its source is `art/icon.svg`, which
is not packaged; re-render the PNG from it with any SVG renderer. `art/task-icon.svg`
is the same mark with the glyph enlarged for 32px, rendered to the task's
`packages/task/icon.png`.

## Publishing

Two publishes exist here, and only one of them is unblocked.

### The dev publish — `MichaelC`, private

Unblocked, and how the extension gets into an organisation you own personally so
the [harness](harness/README.md) can run. It publishes privately under the dev
publisher and shares to one organisation:

```bash
node_modules/.bin/tfx extension publish \
  --vsix packages/extension/dist/MichaelC.bicep-whatif-dev-0.1.0.vsix \
  --share-with <your-org> \
  --token "$tfx_pat"
```

Run it from the repo root. `<your-org>` is the organisation **name**, not a URL.

**Sharing is not installing.** `--share-with` only makes the extension available
to the organisation; installing it is a separate click in Organisation settings →
Extensions → Shared. The harness pipeline will not validate until it is installed.

The PAT needs *Marketplace (publish)*, belongs to the publisher account rather
than to a project, and is not the read PAT this repo's sibling tooling uses.
Keep it out of the shell history and out of any transcript — export it and pass
it by variable, as above.

**Republishing the same version fails.** Bump first with
`node scripts/package.mjs --rev-version`, which mutates `task.json` and
`package.json` and therefore wants committing.

### The release publish — not yet done

The release identity is not settled yet. Until it is, the task's markdown
summary (`publishSummary`, on by default) is what a pipeline without the
extension installed still gets.

It would use `--overrides overrides/release.json`, which is gitignored for the
reason in "The publisher is never committed" above. **Never `--share-with` an
organisation people rely on from the dev publisher** — identity is `{publisher}.{id}`, so
even once creates an install people must later be migrated off.
