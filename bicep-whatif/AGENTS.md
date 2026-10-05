# bicep-whatif

One extension in the `mfclay/azure-devops-extensions` repo; this folder is its own npm
project. Repo-wide rules (CI layout, how extensions sit side by side) are in the root
`AGENTS.md`. Run everything below from this folder.

An Azure DevOps extension: a build-results tab that renders deployment-stack
what-if results, plus the pipeline task that produces them. Four workspaces —
`core`, `task`, `ui`, `extension` — and a harness that lights the tab up with
committed fixtures instead of a real Azure subscription.

Start with `README.md`, then the per-package READMEs. This file holds only the
things that are **easy to get wrong and expensive to get wrong**.

## The Marketplace PAT — use `tools/tfx-run`, never the raw token

A Manage-scoped publish PAT is exported by the shell profile as `tfx_pat`.

**Never read, print, cat, or grep that value, and never ask for it to be pasted.**
A credential that reaches a transcript cannot be recalled from one; the only
remedy is revoking and reissuing it.

There is no need to. `tools/tfx-run` passes it by shell expansion and filters it
out of every byte of output, so the value stays unreadable even if a tool echoes
its own credential back in an error:

```bash
zsh -lc 'tools/tfx-run extension isvalid --publisher MichaelC \
  --extension-id bicep-whatif-dev --version 0.1.0'
zsh -lc 'tools/tfx-run extension show --publisher MichaelC \
  --extension-id bicep-whatif-dev --json'
```

`zsh -lc` is required — the profile is what exports the variable. The wrapper
supplies `--service-url` and `--token` itself; do not pass either. Its header
explains the two mechanisms and what they deliberately do not protect against.

`isvalid` and `show` are read-only and safe to run unprompted. `share`,
`unshare` and `publish` change state on a real Marketplace account — **ask
first.** `publish` especially: see the next section.

## Azure DevOps in the test organisation — use `tools/ado-run`

`tools/ado-run` wraps `az` for the test organisation, with its own PAT and the same redaction
as `tools/tfx-run`. Run it under `zsh -lc` for the same reason:

```bash
zsh -lc 'tools/ado-run devops extension list --output table'
zsh -lc 'tools/ado-run pipelines build list --output table'
```

## Never interpolate a secret to inspect it

`${var:-default}` returns the **value** when the variable is set — it substitutes
the default only when *unset*. So the instinctive "is it set?" one-liner prints
the secret:

```bash
echo "${tok:+SET}${tok:-NOT SET}"   # WRONG — prints the token when set
echo "${tok:+SET}"                  # right — prints SET or nothing
```

A credential that reaches a transcript cannot be recalled from one. Use the wrappers, which redact their own output,
and read exit codes rather than values.

## A published version is gone forever

The Marketplace rejects a republish of an existing version, and there is no way
to reclaim one. Before publishing anything, ask what is already there:

```bash
zsh -lc 'tools/tfx-run extension show --publisher MichaelC \
  --extension-id bicep-whatif-dev --json'   # read `versions`
```

Do not record the current version here — it goes stale the moment someone
publishes. Ask the Marketplace instead.

**`--rev-version` does not solve this and must not be reintroduced.** It reaches
`tfx` after `package.mjs` has staged the manifest into `build/`, so it bumps a
throwaway copy that is deleted next run and always re-derives from the committed
version. Two runs both produce the same "bumped" number and the second collides.

**A red publish job does not mean nothing was published.** `tfx` waits for
Marketplace validation synchronously, gives up after a few minutes, and exits
255 — on an upload that was accepted and goes on to validate fine. Always check
`isvalid` before concluding a publish failed, and certainly before retrying one.

## The publisher is never committed (decision F1)

Extension identity is `{publisher}.{id}`, so changing the publisher creates a
*different* extension with no upgrade path and no install continuity.
`vss-extension.json` therefore names no publisher, and packaging refuses to run
without `--overrides-file`. `overrides/dev.json` is committed, and sets the dev id
`bicep-whatif-dev` so dev and release can share the `MichaelC` publisher while staying
separate extensions. `overrides/release.json` is gitignored and written by hand.

The same reasoning is why **the dev extension is shared only into a single
test organisation** — sharing it anywhere people would come to rely on it
creates an identity they have to be migrated off.

## Fixtures are scrubbed, and that is enforced

`packages/core/fixtures/` holds scrubbed captures of pipeline runs.
`tools/scrub-fixture.mjs` substitutes identifiers; `tools/check-identifiers.mjs`
verifies it stayed done and runs first in CI.

It reads `git ls-files`, so **an untracked fixture is not scanned at all** — a
clean report on a file you have not `git add`ed means nothing was checked.

Run the scrubber from **outside** the repo: `--seed` carries a real identifier on
the command line. Procedure, including the one-invocation rule and its
documented exception: `packages/core/fixtures/README.md`.

## Verifying

Put Node 20 on `PATH` first — `/opt/homebrew/opt/node@20/bin` — because that is
the line CI runs and the floor the workspace claims. The machine's default Node
is newer and will not catch what CI catches.

```bash
npm ci                                            # not `npm install`
npm run check:identifiers
npm run typecheck
npm test                                          # core · task · ui · extension
npm run build
npm run package -w @bicep-whatif/extension
```

Two of those assertions carry the design: a `task` pass means **a sidecar is
written on every path out of the run**, including a failed compile or ARM
refusing the request. A `ui` pass means **a stage that produced no attachment
still reaches the screen ranked `unevaluated`** rather than vanishing — the
failure the whole join exists to prevent.

`npm run dev -w @bicep-whatif/ui` then `?mock=1` shows the tab with no
Azure at all, but proves nothing about the SDK handshake — it bypasses Azure
DevOps entirely. Only an installed build reaches that.
