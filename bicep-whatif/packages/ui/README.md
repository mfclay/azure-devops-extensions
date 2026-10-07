# `@bicep-whatif/ui`

The build-results tab: a static React 19 SPA that reads build attachments,
reconciles them against the build timeline, and renders the rows
[`@bicep-whatif/core`](../core) produces.

```bash
npm install
npm run dev -w @bicep-whatif/ui    # http://localhost:5173/?mock=1
npm test -w @bicep-whatif/ui       # 57 tests
npm run build -w @bicep-whatif/ui  # tsc --noEmit, then vite build
```

`?mock=1` needs neither Azure nor Azure DevOps — it loads the committed fixtures
from `packages/core/fixtures`. That is decision **E4**, and the mode ships in the
production bundle on purpose: it is the fastest bug-repro channel this project
has. Someone with a broken tab can open it and immediately tell a rendering bug
from a data problem.

## The one thing this package must get right

**Absence of data must never render as absence of change** (design §03, decision
**E3**).

What-if stages run `continueOnError: true`, so a stage that fails lands on
`SucceededWithIssues` and attaches *nothing*. A tab that rendered only the
attachments it received would show eight clean stacks as a safe deploy while the
ninth was never evaluated at all.

So the data layer reconciles against the build **Timeline API**, not against the
attachment list. Every `WhatIf_*` stage in the run gets a row; attachments join
onto it. A stage with no attachment becomes a row ranked `unevaluated` — the rung
`core` reserves for exactly this, which sits above `noChange` so the default
filter cannot bury it — plus a banner at the top of the page that does not
dismiss.

That path is covered at three levels: [`test/join.test.ts`](test/join.test.ts)
(the join), [`test/estate.test.ts`](test/estate.test.ts) (the row and its rung),
and [`test/app.test.tsx`](test/app.test.tsx) (it reaches the screen in the
default view, without touching a filter).

## The six UX decisions, answered

These blocked the package for two sessions. They are settled; **do not re-ask
them**, and change them only deliberately.

| | Question | Answer |
|---|---|---|
| 1 | Master-detail or expand-in-place for property deltas? | **Master-detail side panel.** Fixed row heights keep virtualization simple at thirty stacks, and it pairs with deep links. |
| 2 | A summary strip of counts per rung? | **Yes — and the chips *are* the severity filter.** One control, so the count and the filter cannot disagree. |
| 3 | Where do filters live? | **A toolbar.** Full width stays with the grid, which matters in a narrow tab iframe. |
| 4 | Do rows deep-link? | **Yes** — filters *and* the selected resource live in the URL hash. |
| 5 | What does the tab open on? | **Everything above `noChange`**, severity-descending. `unevaluated` is in that set by construction. |
| 6 | How does the stack list behave at thirty? | **Searchable multi-select, grouped by layer**, each row showing that stack's worst rung. |

Decision **E2** settled the adjacent one before this package existed: severity is
the default spine and stack is a *filter*, never the primary grouping. Grouping by
stack first buries a single `Delete` in stack seven under two hundred benign
`Modify`s in stack one.

## How it is put together

| Path | What it does |
|---|---|
| `src/data/join.ts` | Timeline records + attachments → `StageResult[]`. Pure, and where the correctness rule is enforced. |
| `src/data/ado.ts` | Fetches through the SDK. Thin, because it cannot be exercised offline. |
| `src/data/mock.ts` | The fixtures, plus two stages that attached nothing. |
| `src/model/estate.ts` | `StageResult[]` → grid rows, via `core`'s normalizer. |
| `src/model/view.ts` | Filter state, the default view, and the sort. Pure. |
| `src/model/urlState.ts` | View state ⇄ URL hash. Pure, round-trip tested. |
| `src/nav/navigation.ts` | The host's hash, with a `window` fallback. |
| `src/components/` | Banners (not-evaluated stacks, notes about the build), strip, toolbar, stack menu, grid, detail panel, delta tree. |

Sorting and filtering are **pure functions, not table features** — they are
product decisions and belong somewhere they can be tested without mounting a
component. TanStack Table earns its place as the column model and cell renderer;
TanStack Virtual does the windowing.

### The design idea worth keeping

The **severity rail** — the 3px bar down each row's left edge, opacity tracking
`SEVERITY_RANK`. Rows of the same rung form one contiguous band, so the left edge
of the grid reads as a vertical histogram of the run. `unevaluated` is **hatched**
rather than coloured, because it is not a severity: it is the absence of an
answer, and hatching says that without competing with the rungs either side.

The **"why" line** under a resource name appears only when the ranking is not
what the change type alone would predict — a `noChange` resource that lost
management shows its reason; a plain `modify` does not. Printing a reason on two
hundred routine rows trains people to stop reading the line, and then the one row
that matters gets skipped with the rest.

## Traps

1. **Do not add `azure-devops-ui`.** Maintained, but pinned to `react ^16.8.1`,
   while `@tanstack/react-table` needs `react >=18`. Mutually exclusive. Theme
   against Azure DevOps' CSS custom properties instead — `src/styles/theme.css`
   does, and the tab follows the host's theme with no theme code of its own.

2. **`azure-devops-extension-sdk` is pinned to `^4`.** `azure-devops-extension-api`
   peer-deps it at `^2 || ^3 || ^4` while the SDK's own latest is `5.0.0`.
   Microsoft's two packages disagree. The lockfile resolves 4.2.0 and installs
   clean — do **not** reach for `--legacy-peer-deps`.

3. **Severity is not re-implemented here.** `core` owns the four-axis collapse so
   the task and the tab agree by construction. `GridRow.reasons` widens core's
   `code` field to `string` so a stage placeholder can carry a reason core has no
   concept of; that is the only concession, and the rung and rank still come from
   `SEVERITY_RANK`. If the UI needs a rung `core` lacks, change `core` and its
   tests.

4. **The property-level `changeType` is a different enum from the resource-level
   one.** It adds `array` and `noEffect`, drops `detach` and `noChange`, and both
   extras appear in the real captures. `PropertyDeltaTree` gives them their own
   word marks (`add`/`del`/`mod`/`arr`/`noop`); no `SEVERITY_GLYPH` appears in it.

5. **`CommonServiceIds` is an ambient `const enum`**, so it has no runtime object
   and `isolatedModules` forbids inlining it. `src/nav/navigation.ts` uses the
   member's literal value, with a comment saying where it came from.

6. **Vitest runs without `@vitejs/plugin-react`.** Vitest resolves its own Vite 7
   while dev/build runs Vite 8, and `@vitejs/plugin-react@6` peer-deps `vite ^8`;
   loading it in `vitest.config.ts` would put two copies of Vite in one process.
   esbuild's automatic JSX runtime covers the tests.

## Not done here

- **The extension manifest and the task** live in `packages/extension` and
  `packages/task`. The manifest names no publisher; decision **F1** drives it
  from `tfx --overrides-file`.
- **`src/data/ado.ts` has never seen a live response.** The pipeline side has not
  landed `whatif.stack.json` yet — that is the sibling attachment track. The
  attachment type strings and the sidecar shape here match what that track
  specifies; everything decidable without the network lives in `join.ts` and is
  tested there.
