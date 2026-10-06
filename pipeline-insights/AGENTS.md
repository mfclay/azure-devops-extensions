# pipeline-insights

## Layout and commands

One npm workspace in this folder: `core`, `ui`, `dev`, `extension`, with the project's tools in
`tools/`. DEVELOPMENT.md has the tree. From here:

```bash
npm ci
npm run typecheck        # every package
npm test                 # every package
npm run coverage         # every package's tests, failing under its floor in vitest.config.ts
npm run check:denylist   # every file, against the private denylist
npm run check:readme     # README.md is what tools/readme.mjs builds from the overview
task pre-commit          # all four; run it before every commit
```

Every package has `typecheck` and `test` scripts. A package that depends on another builds it
first through `pre*` scripts, because cross-package imports resolve to the dependency's `dist/`.

## Docs

`docs/design.md` and `docs/build-out-plan.md` are the source of truth. Read them before changing
behaviour. When a decision changes, or a milestone lands, update the doc in the same commit as
the code.

## Publishing

- **No publisher in the manifest.** Extension identity is `{publisher}.{id}`, so the publisher
  comes only from an overrides file passed to `extension/scripts/package.mjs` with
  `--overrides <path>`. There is no default path, and the script refuses to run without one.
- **Dev** builds use `extension/overrides/dev.json`, which is committed: the `pipeline-insights-dev`
  id, the dev publisher, private, Preview, a "(dev)" name. `zsh -lc 'tools/publish-dev'` runs the whole dev publish (version
  check, tests, package, publish, wait for validation, share and install in the test
  organization once). Publishing changes a real Marketplace account and a version can never be
  reused, so **ask before running it**. `tfx-run extension isvalid` and `show` are read-only.
- **Release** is the publish workflow with `release` ticked, or from a terminal a copy of
  `extension/overrides/release.example.json` as `release.json` (gitignored) with the version set.
  The publisher is `MichaelC`, the same as dev. The release keeps the manifest's
  `pipeline-insights` id, so it is a different extension from the dev one, not an upgrade.
  `RELEASING.md` has the steps; a release is the user's to start.
- `tools/tfx-run` wraps every Marketplace call: it supplies `--service-url` and redacts the PAT
  from output. `tfx` exits 255 on uploads the Marketplace accepted, so read success from
  `tfx extension isvalid`, never the exit code. Never read, print or ask for the PAT itself.

## Fixtures

The committed fixture is synthetic: `core/fixtures/contoso.json`, built by `contoso.ts`. Edit
the generator and run `npm run fixture -w @pipeline-insights/core`; a golden test fails if the
JSON is not what the generator builds. After a change to the estate or the rules, review the
diffs `npx vitest run -u` makes to the `*.golden.json` files before keeping them.

- **Never commit a recording of a real project.** `capture-fixture` writes to
  `core/fixtures/recorded/`, which git ignores.
- Only tests, the dev page and the demo hub import fixtures. Nothing reachable from the hub's
  entry point imports them in a normal build, so the bundler never sees them.
- **The demo hub** (`npm run build:demo -w @pipeline-insights/extension`, then
  `node scripts/package.mjs --overrides overrides/demo.json --demo`) is the real hub reading the
  contoso estate, with its timestamps moved to now, for Marketplace screenshots inside Azure
  DevOps. A Vite plugin swaps the hub's `src/source.ts` for `src/demo-source.ts` in that build
  only. It publishes as the private `pipeline-insights-demo` extension, shared only with the test
  organization; packaging refuses `--demo` for anything else, because it skips the identifier
  check.
- `tools/check-identifiers.mjs` is the second guard. `package.mjs` runs it over the staged
  `build/` directory, and it fails a package that carries any name or GUID the fixtures hold,
  a run URL, a subscription path, or a denylist match.
