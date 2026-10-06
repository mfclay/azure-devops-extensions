# Developing Pipeline Insights

An Azure DevOps extension: a page in the Pipelines menu that shows every pipeline in a project
at once. It leads with what needs attention, then groups the rest by folder and by release line
(CI, build, deploy). The design is in [docs/design.md](docs/design.md), the build plan in
[docs/build-out-plan.md](docs/build-out-plan.md).

[README.md](README.md) is built from the Marketplace overview, `extension/overview.md`. Edit
the overview, then run `npm run readme`; `task pre-commit` fails while the two differ.

## Layout

```text
package.json              npm workspaces
tsconfig.base.json
Taskfile.yml              task pre-commit
docs/                     design and build plan
tools/                    tfx wrapper, identifier check, denylist check, README builder
core/                     rules and parsing; no network calls, no Azure DevOps SDK
  fixtures/               the synthetic contoso estate, its generator, and the goldens
ui/                       React components, themed by the host page
extension/                manifest, hub entry point, Azure DevOps data source, packaging
dev/                      local dev page: ui and core on the fixture estate
```

`core` and `ui` know nothing about Azure DevOps's SDK: each host supplies its own data source.

## Build and test

Node 20 or later. From this folder:

```bash
npm ci
npm run typecheck
npm test
npm run check:denylist
npm run check:readme
```

Every package has `typecheck` and `test` scripts. `task pre-commit` runs all four checks. To
work on the page locally, run `npm run dev -w @pipeline-insights/dev`.

## Publishing

[RELEASING.md](../RELEASING.md) at the repo root has the whole process: dev builds, the release
steps, credentials and the listing. In short:

An extension's identity is `{publisher}.{id}`. Changing the publisher creates a different
extension, with no upgrade path from the old one, so the publisher is never stored in the
manifest.

- **Packaging needs an overrides file.** `extension/scripts/package.mjs` refuses to run without
  `--overrides <path>`, and there is no default path.
- **Dev publish:** `zsh -lc 'tools/publish-dev'` packages with the committed
  `extension/overrides/dev.json` and publishes the next free patch version.
- **Release:** the publish workflow with `release` ticked, or from a terminal a copy of
  `extension/overrides/release.example.json` as `release.json` (gitignored) with the version set
  (`RELEASING.md`, "A release"). The release is a different extension from the dev build, not an
  upgrade of it.
- `tools/tfx-run` wraps every Marketplace call: it supplies `--service-url` and redacts the PAT
  from output.

## Fixtures

Tests and the dev page run on the synthetic `contoso` estate in `core/fixtures/`, outside `src/`:
33 made-up pipelines built by `core/fixtures/contoso.ts` (`npm run fixture -w
@pipeline-insights/core` rewrites the JSON). Fixtures are imported only by tests and the dev
page, never by shipped code, and a check over the staged package fails it if fixture names, a
subscription id or a run URL get in.

`npm run capture-fixture -w @pipeline-insights/core -- --org … --project …` records a real
project with a read-only PAT in `AZURE_DEVOPS_EXT_PAT`. The recording is that project's data: it
goes to the gitignored `core/fixtures/recorded/` and is never committed.
