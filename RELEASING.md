# Releasing

How the extensions in this repo get from a commit to the Visual Studio Marketplace: dev builds
you can install and click through, and the public release. It is written to be reusable. Most
of it applies to any Azure DevOps extension, and each rule says why it exists.

Each extension's own docs cover what is specific to it: [Pipeline Insights](pipeline-insights/DEVELOPMENT.md)
and [Bicep What-If](bicep-whatif/packages/extension/README.md).

## Identity comes first

A Marketplace extension is identified by `{publisher}.{id}`. Change either one and you have
made a **different extension**: nobody who installed the old one is upgraded, and nothing
carries over. So identity is decided once and protected from accidents.

- **The manifest names no publisher.** `vss-extension.json` holds the id, never the publisher.
  The publisher comes only from an overrides file passed to `scripts/package.mjs`. Pipeline
  Insights' packaging refuses to run without one; Bicep What-If's falls back to `dev.json`. A publisher committed in the manifest would have to be edited to
  release, and that edit would quietly create a second extension.
- **Dev and release share a publisher and differ by id.** Each extension has a committed
  `overrides/dev.json` that sets an id ending in `-dev` (`pipeline-insights-dev`), a "(dev)"
  name, `public: false` and the Preview flag. The release keeps the manifest's clean id. Both
  live under one verified publisher, `MichaelC`, so there is one account to manage.
- **The release overrides are not committed.** The publish workflows stage them from the run's
  inputs, and from a terminal `overrides/release.json` is copied from
  `overrides/release.example.json` by hand and gitignored. Releasing should be a deliberate act,
  not a default someone inherits.
- **A pipeline task needs its own identity too.** Bicep What-If ships a task. An organization
  cannot install two extensions whose tasks share a GUID, and two tasks with one name make
  `StackWhatIf@0` ambiguous. So `overrides/dev.json` also gives the dev build's task its own
  GUID and name, and `package.mjs` applies them to the staged copy only. With that, dev and
  release can be installed side by side.
- **Dev builds are shared with one test organization you own.** Sharing a dev build into an
  organization people rely on creates an install they would later have to be moved off.

## A version can be published once

The Marketplace rejects a version it already has, and a version can never be reclaimed, not even
from a failed or abandoned upload. So:

- **Ask the Marketplace what exists before publishing**, rather than trusting a number written
  down somewhere: `tools/tfx-run extension show --publisher MichaelC --extension-id <id> --json`
  lists the versions.
- **Set the version in the overrides, not in the manifest.** The publish scripts write the
  version into a staged copy of the overrides file. The manifest's `version` stays put.
- **Do not use `tfx --rev-version`.** `tfx` sees the manifest only after `package.mjs` has
  staged it into `build/`, so it bumps a throwaway copy. Every run re-derives the same "next"
  number, and the second run collides.

## Credentials

- **The Marketplace token** is a personal access token with the **Marketplace (Manage)** scope,
  created for **All accessible organizations** (Marketplace tokens do not work when limited to
  one organization). Locally it is exported from `~/.zshenv` as `tfx_pat`, which zsh loads for
  every shell, so the tools are run as `zsh -lc '…'`.
- **Never type the token into a command.** `tools/tfx-run` (one per extension) passes it to
  `tfx` itself, adds the service URL, and redacts the token from every byte of output, in case
  a tool prints its own credential in an error. `tools/ado-run` does the same for `az`
  against the test organization, with its own read token.
- **The test organization** is named by `ADO_TEST_ORG`, also exported from `~/.zshenv`. The
  tools read it from there; no organization name is written in the repo.
- **To check whether a secret is set, use `${var:+set}`**, never `${var:-default}`: the
  second prints the value whenever the variable is set.
- **In GitHub Actions**, the token is the `MARKETPLACE_PAT` secret of two environments:
  `marketplace` for dev builds and dry runs, and `marketplace-release` for releases, which
  names a required reviewer so that a release waits for approval. Approval is set per
  environment, so a single environment would make every dev build wait too. Only the publish
  workflows declare either environment, so the CI workflows cannot read the token at all; for
  the same reason it is never a repository secret. The publisher and the organization to share
  with are the `EXTENSION_PUBLISHER` and `EXTENSION_SHARE_WITH` variables. They are repository
  variables, not environment ones, so both environments see the same values; neither is secret.

## Dev builds

Publish dev builds freely: they are private, and a version number costs nothing.

**Pipeline Insights**, from `pipeline-insights/`:

```bash
zsh -lc 'tools/publish-dev'            # next free patch version
zsh -lc 'tools/publish-dev --version 0.2.0'
```

It checks the version is free, typechecks, tests and builds, packages with a staged copy of
`overrides/dev.json`, publishes, waits for validation, and on the first publish shares the
extension with the test organization and installs it there.

**Bicep What-If**, from `bicep-whatif/`, has no wrapper yet; the steps are the same by hand:

```bash
npm run build
# a copy of overrides/dev.json with "version" set, kept outside the repo
npm run package -w @bicep-whatif/extension -- --overrides /path/to/staged-dev.json
zsh -lc 'tools/tfx-run extension publish --vsix packages/extension/dist/MichaelC.bicep-whatif-dev-<version>.vsix --no-wait-validation'
zsh -lc 'tools/tfx-run extension isvalid --publisher MichaelC --extension-id bicep-whatif-dev --version <version>'
```

**From GitHub Actions**, either extension: Actions → *Pipeline Insights Publish* or *Bicep What-If
Publish* → Run workflow, with `release` left unticked. Leave the version blank to get the next
patch after the newest published, as `publish-dev` does; the same works for a release. These workflows re-run the whole chain
first so nothing untested reaches the Marketplace, and are started by hand only.
`bicep-whatif/tools/gh-run publish` dispatches a dev build of Bicep What-If, with an optional
version.

Two things that look like failures and are not:

- **`tfx` can exit non-zero on an upload the Marketplace accepted** (255 after it gives up
  waiting). Read the result from `tfx extension isvalid`, which prints `Valid` once the version
  passes. Never retry a publish before checking, because the retry may collide with the version
  you just used.
- **Sharing is not installing.** `tfx extension share` makes a private extension visible to an
  organization. Someone still has to install it there (Organization settings → Extensions →
  Shared), and a build pipeline cannot use its task until they do.

## A release

A release is one run of the extension's publish workflow, with `release` ticked and approved by
a reviewer. The terminal steps after it are the fallback, and do by hand what the workflow does.

**Once, before the first release from GitHub Actions**, in the repository's Settings →
Environments, create `marketplace-release`:

- add yourself as a required reviewer, and leave *Prevent self-review* unticked, since the
  person who starts the run is the one who approves it;
- limit its deployment branches to `main`;
- give it its own `MARKETPLACE_PAT` secret, the same kind of token as the `marketplace` one.

### From GitHub Actions

1. **Start from a green `main`.** `task pre-commit` passes on the commit you will release, and
   CI is green. `task pre-commit` ends with the denylist scan, and that is the only denylist scan
   a release from GitHub Actions gets: the list is kept off GitHub, so the runner has none.
2. **Choose the bump.** Leave the version blank and the run takes the newest published release
   and raises it by `bump`: `patch` (the default), `minor` or `major`. A typed version
   overrides that. The first release of an extension has nothing to raise, so type it once.
3. **Dry run.** Actions → *Pipeline Insights Publish* or *Bicep What-If Publish* → Run workflow
   on `main`, with `release` and `dry_run` ticked, and `bump`, `public` and `gallery_flags` as
   the release should have them. `public` lists it publicly; `Preview` keeps the Preview badge
   on a version you do not yet call stable. The run's summary shows the version it chose.

   The dry run does everything up to the upload: the whole chain, the version check, packaging
   (Pipeline Insights runs its identifier check over the staged files), and a check that the
   VSIX manifest's publisher, id, version, display name (no "(dev)") and flags match the
   inputs. It keeps the VSIX as the run's artifact; look inside it (`unzip -l`) to see that the
   overview's images are there. It needs no approval, and costs no version.
4. **Release.** Run it again with the same inputs and `dry_run` unticked. The job waits for
   approval in `marketplace-release`; approve it from the run's page. It then publishes, always
   waits for validation, and tags the commit `<extension>-v<version>`. If the tag cannot be
   pushed, the run fails with the release live and names the commit to tag by hand (step 7
   below).
5. **Check the live listing.** Images and links resolve, and the icon is the one you shipped.

A release is refused from any branch but `main`. A dry run is not, which is how a change to a
publish workflow can be tried out before it lands.

### From a terminal

Pipeline Insights, from `pipeline-insights/extension/`:

1. **Start from a green `main`.** `task pre-commit` passes, and CI is green.
2. **Write the release overrides.** Copy `overrides/release.example.json` to
   `overrides/release.json` and fill it in:

   ```json
   {
     "publisher": "MichaelC",
     "version": "1.0.1",
     "public": true,
     "galleryFlags": []
   }
   ```

   `public: true` lists it publicly. An empty `galleryFlags` drops the Preview badge; keep
   `["Preview"]` for a version you do not yet call stable.
3. **Build and package.**

   ```bash
   (cd .. && npm run build)
   npm run package -- --overrides overrides/release.json
   ```

   Packaging stages the extension into `build/`, runs the identifier check over the staged files
   (below), and writes `dist/MichaelC.pipeline-insights-<version>.vsix`.
4. **Inspect what you are about to publish.** The manifest inside the VSIX is the truth:

   ```bash
   unzip -p dist/MichaelC.pipeline-insights-1.0.1.vsix extension.vsixmanifest \
     | grep -E '<Identity|<DisplayName|GalleryFlags|Icons.Default'
   unzip -l dist/MichaelC.pipeline-insights-1.0.1.vsix
   ```

   Check the publisher, id and version, the display name (no "(dev)"), the flags, and that the
   overview's images are in the archive.
5. **Publish, then wait for validation.**

   ```bash
   cd .. && zsh -lc 'tools/tfx-run extension publish --vsix extension/dist/MichaelC.pipeline-insights-1.0.1.vsix --no-wait-validation'
   zsh -lc 'tools/tfx-run extension isvalid --publisher MichaelC --extension-id pipeline-insights --version 1.0.1'
   ```

   Validation took two to seven minutes for these extensions; `tfx` says it can take up to 20.
6. **Check the live listing.** Images and links resolve, and the icon is the one you shipped.
7. **Tag the release commit**, as a marker only:

   ```bash
   git tag pi-v1.0.1 <commit> && git push origin pi-v1.0.1
   ```

   Tags are `<extension>-v<version>` (`pi-v…`, `whatif-v…`), never a bare `v1.0.1`, because the
   repo holds more than one extension. No workflow subscribes to them. They used to start the
   dev publish workflows, so a tag on an older commit, whose workflow files still had that
   trigger, would publish a dev build. Tag only commits made after that changed.

The first public release can go into an extension id that already exists privately: publishing
with `public: true` makes it public and replaces its name with the manifest's. Bicep What-If
has not had a release yet. Its release overrides have no `task` block, so the release ships the
task under its permanent GUID and name. It has no identifier check over the staged files: its
check scans every tracked file before the build, which is everything the repo puts in the VSIX,
and the rest is bundled third-party code, where a GUID or address scan finds only the
libraries' own constants.

## Before the repo or the listing goes public

The listing links to the repository and its issues, so the repo has to be public first, and
everything in it is then readable by anyone.

- **Scan the whole history, not just the tree.** `task denylist:history` checks every commit's
  files and messages against a private list of names that must never appear (below).
- **Actions run history outlives a rewritten history.** Runs keep the commit messages and logs
  of commits you squashed away. Delete those runs, or recreate the repository. Commits that are
  no longer on any branch also stay fetchable by their hash until GitHub collects them.
- **Look at every image.** The scans read file contents, not pixels, so a screenshot can show a
  name that no check will catch.

## The listing

The listing page is built from the manifest and its `content.details` file, `overview.md`.

- **Images are relative paths in the overview**, such as `![…](images/hero-banner.png)`, with
  the files under `images/`, which the manifest's `files` entry marks addressable. They resolve
  on the listing page.
- **Make the icon 256×256.** The page draws it in a 128-pixel box, and on a high-density screen
  that box is 256 physical pixels wide, so a 128-pixel file is stretched 2× and looks soft. Render
  it from the vector source rather than scaling the 128 export up.
- **A hero banner** (2560×1280 here) can open the overview in place of its heading, since the
  page header already shows the name.
- **Take screenshots on data you can publish.** Pipeline Insights has a demo build
  (`npm run build:demo`) that is the real hub reading a synthetic estate, published as a private
  `-demo` extension to the test organization. The screenshots never show a real project.
- **One text, two places.** Pipeline Insights' `README.md` is built from `overview.md` by
  `npm run readme`, so GitHub shows the folder the same page the Marketplace does, and
  `task pre-commit` fails while the two differ.

## The checks that guard a release

`task pre-commit` runs before every commit and runs each extension's typecheck and tests, plus:

- **The identifier check.** Pipeline Insights scans the staged VSIX for any name or GUID its
  fixtures hold, run URLs and subscription paths, so no fixture data or captured identifier can
  ship. Bicep What-If runs its check over the tracked files first in CI.
- **The denylist.** A list of names that must never appear in this repo, kept outside it (a list
  in the repo would publish the names it guards). The scans report hits by line number, never by
  the matched text. The tooling is public; only the list is private.

**The repo-wide scan greps binary files too**, and a few bytes of compressed PNG data can happen
to match a short pattern. That is a false positive, but the fix is not to skip images: re-encode
the PNG losslessly, which changes the bytes without changing a pixel.
