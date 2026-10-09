# `@bicep-whatif/ui`

The build-results tab: a static React 19 SPA that reads build attachments,
reconciles them against the build timeline, and renders the rows
[`@bicep-whatif/core`](../core) produces.

```bash
npm install
npm run dev -w @bicep-whatif/ui    # http://localhost:5173/?mock=1
npm test -w @bicep-whatif/ui       # 211 tests
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
attachment list. Every `WhatIf_*` stage in the run gets a row, and so does any
other stage a what-if attachment traces to; attachments join onto it, one stack
per stack id when a stage runs several. A stage with no attachment becomes a row
ranked `unevaluated` — the rung
`core` reserves for exactly this, which sits above `noChange` so the default
filter cannot bury it. On screen, the headline says how many stacks were not
evaluated, and those stacks get their own group, under the risky stacks and
above every ordinary modify. Neither dismisses, and no filter changes the
headline.

That path is covered at three levels: [`test/join.test.ts`](test/join.test.ts)
(the join), [`test/estate.test.ts`](test/estate.test.ts) (the row and its rung),
and [`test/app.test.tsx`](test/app.test.tsx) (it reaches the screen in the
default view, without touching a filter).

## The UX decisions, answered

These are settled; **do not re-ask them**, and change them only deliberately.
Decisions 1, 2 and 5 were revised before 1.0, after the tab was reviewed in a
real organisation; the reasons are below the table.

| | Question | Answer |
|---|---|---|
| 1 | Master-detail or expand-in-place for property deltas? | **Expand in place.** A row opens beneath itself, full width, property changes first as a Property / Before / After table. Several can be open at once. |
| 2 | A summary of counts per rung? | **One line of plain words, and it *is* the severity filter.** Colour on the number only, for destructive, protection loss and new. Zero counts are left out; the headline states what a zero would have implied. |
| 3 | Where do filters live? | **A toolbar**, pinned while the page scrolls. |
| 4 | Do rows deep-link? | **Yes** — filters, the layout, open stacks *and* open resources live in the URL hash. An open row is shown whatever the filters say. |
| 5 | What does the tab open on? | **A headline sentence, then one line per stack, worst first**, with that stack's counts in one column per rung. "All resources" switches to the flat list ranked by severity across every stack. Both hide `noChange` by default; `unevaluated` is shown by construction. |
| 6 | How does the stack filter behave at thirty? | **Searchable multi-select, grouped by layer**, each row showing that stack's worst rung. |

**Why 1, 2 and 5 changed.** The host gives the tab a fixed-height frame (632px
in a typical window). The banners, the chip strip and the toolbar took about
60% of it before the grid started, and the side panel got what was left: seven
sections in a 420px column, property changes third. The chips said each count
three times (glyph, coloured number, coloured word) inside a coloured border.
The review called it overwhelming, the same problem as reading the raw what-if
output.

Decision **E2** said severity is the spine and stack a *filter*, because grouping
by stack in pipeline order buries a single `Delete` in stack seven under two
hundred `Modify`s in stack one. The stack layout keeps that guarantee by its
order, not by dropping the grouping: stacks are ranked by the most severe change
each holds, every line carries its counts before it is opened, and the headline
names how many stacks would delete or stop protecting anything. The flat list is
one click away for anyone who wants E2's original view.

## How it is put together

| Path | What it does |
|---|---|
| `src/data/join.ts` | Timeline records + attachments → `StageResult[]`. Pure, and where the correctness rule is enforced. |
| `src/data/ado.ts` | Fetches through the SDK. Thin, because it cannot be exercised offline. |
| `src/data/mock.ts` | The fixtures, plus two stages that attached nothing. |
| `src/model/estate.ts` | `StageResult[]` → grid rows, via `core`'s normalizer. |
| `src/model/view.ts` | Filter state, the default view, open rows and stacks, and the sort. Pure. |
| `src/model/summary.ts` | The headline, and how stacks group and order. Pure. |
| `src/model/urlState.ts` | View state ⇄ URL hash. Pure, round-trip tested. |
| `src/nav/navigation.ts` | The host's hash, with a `window` fallback. |
| `src/components/` | Headline, totals, toolbar, stack menu, stack list, resource rows, a row or stack opened, property changes, notes about the build. |

Sorting, filtering, grouping and the headline are **pure functions** — they are
product decisions and belong somewhere they can be tested without mounting a
component. Rows are not virtualized: a row that opens in place has no fixed
height, the estates this reads are hundreds of rows rather than tens of
thousands, and the stack layout renders only the stacks someone opened.

### The design idea worth keeping

The **severity rail** — the 3px bar down each row's left edge, opacity tracking
`SEVERITY_RANK`. Rows of the same rung form one contiguous band, so the left edge
of the list reads as a vertical histogram of the run. Stack lines carry it too,
in the colour of their worst rung. `unevaluated` is **hatched**
rather than coloured, because it is not a severity: it is the absence of an
answer, and hatching says that without competing with the rungs either side.

The **"why" line** under a resource name appears only when the ranking is not
what the change type alone would predict — a `noChange` resource that lost
management shows its reason; a plain `modify` does not. Printing a reason on two
hundred routine rows trains people to stop reading the line, and then the one row
that matters gets skipped with the rest.

## Traps

1. **Do not add `azure-devops-ui`.** Maintained, but pinned to `react ^16.8.1`,
   and this tab is React 19. Theme against Azure DevOps' CSS custom properties
   instead — `src/styles/theme.css` does, and the tab follows the host's theme
   with no theme code of its own. Borrow the host's shapes (flat cards, grouped
   rows with counts) rather than its components.

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
   extras appear in the real captures. `PropertyChanges` gives them their own
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
