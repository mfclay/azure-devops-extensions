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

**Absence of data must never render as absence of change** ([design §03](../../docs/design.md#03--severity-and-the-correctness-rule),
decision **E3**).

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
real organisation; the reasons are below the table. A second review of that
layout raised ten observations, cited below as *obs. n*. Decision 6 was revised for
it, and 7 to 15 were added.

| | Question | Answer |
|---|---|---|
| 1 | Master-detail or expand-in-place for property deltas? | **Expand in place.** A row opens beneath itself, full width, property changes first as a Property / Before / After table. Several can be open at once. |
| 2 | A summary of counts per rung? | **One line of plain words that only reports.** Colour on the number only, for destructive, protection loss and new. Zero counts are left out; the headline states what a zero would have implied. The line was the severity filter until the second review: each count was a toggle, on by default, so a click *hid* that kind of change, while the counts looked like links that would show it. Filtering is now the toolbar's **Changes** menu, beside Stacks: a checkbox per kind with its count, and quick picks (All, Deletes and protection loss, None). |
| 3 | Where do filters live? | **A toolbar**, pinned while the page scrolls. |
| 4 | Do rows deep-link? | **Yes** — filters, the layout, open stacks *and* open resources live in the URL hash. An open row is shown whatever the filters say. |
| 5 | What does the tab open on? | **A headline sentence, then one line per stack, worst first**, with that stack's counts in one column per rung. "All resources" switches to the flat list ranked by severity across every stack. Both hide `noChange` by default; `unevaluated` is shown by construction. |
| 6 | How does the stack filter behave at thirty? | **Searchable multi-select, grouped by outcome** in the first screen's four groups, with quick picks *All*, *Needs a look* (will, might and not evaluated) and *None*. Search matches the stack or its stage. Grouping by name prefix is offered only when two or more prefixes exist; otherwise it shows a lone "Other". (obs. 9) |
| 7 | How are stacks that might delete told from stacks that will? | **Two groups.** *Will* when a stack has a definite delete or protection loss, or its own deny settings weaken; *might* when every such change in it is potential. The headline counts both. Grouping moves the stack; `core`'s ladder is untouched. (obs. 1) |
| 8 | Can the totals be read as stacks? | **No: they say RESOURCES**, and the stack list's head reads "Stack · resources per stack →". The headline counts stacks. (obs. 2) |
| 9 | What is a resource Azure couldn't predict called? | **"Not predicted."** "Not evaluated" is said only of a stack with no result. The totals count resources only, and a stage's stand-in row ignores the severity filter, so hiding *not predicted* never hides a stack nobody evaluated. (obs. 3) |
| 10 | How are Azure's warnings said? | **In a plain sentence**, on the closed stack line, with a warning icon. Where Azure couldn't rule out deletes, the sentence says so. Opened, the stack leads with what the warning means for it, and Azure's own text, which shouts, sits behind a disclosure under that. An unknown code falls back to Azure's first sentence. (obs. 4) |
| 11 | Two stack lines with one name? | **The stage becomes a chip**, and a line says whether it is the same stack in another stage (the stack resource ids match) or another stack with that name. (obs. 8) |
| 12 | A long run of property lines under one element? | **One group row** when three or more leaves share a change type: "del ×7", the path, "All 7 properties become absent". Groups start **open** and fold on request; a search match opens one. *absent* is drawn only for a removed line's after or an added line's before; elsewhere `null` is a value. Naming role assignments by role and principal was dropped: Azure sends only GUIDs, and resolving them needs a scope F2 rules out. (obs. 7, obs. 6) |
| 13 | How is the flat list ordered? | **In bands:** will, might, unknown (not predicted or not evaluated), new, modified, unchanged. Unknown sits above new and modified because it can hide a delete. Every row that passes the filters is listed. The type keeps its provider, `Network/virtualNetworks`. (obs. 5, obs. 10) |
| 14 | What does a stack nobody evaluated say when opened? | **"Nothing in this stack was evaluated"**, then why, Azure's error code and message, the stage's result, and a link to the stage's log. It states the result and claims no cause: the tab can't see the pipeline's YAML. |
| 15 | Text glyphs or icons? | **Icons, in the tab only.** `core`'s glyphs stay in the log and summary, and each icon's tooltip names its glyph ("Destructive (-)"). A legend under the stack list explains the icons and the rails' dashes and hatching. |

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
| `src/model/summary.ts` | The headline, how stacks group and order, and the stack filter's picks. Pure. |
| `src/model/diagnostics.ts` | Azure's warnings as plain sentences, and the opened stack's callout. Pure. |
| `src/model/propertyLines.ts` | A resource's property delta as table lines and groups, and its header count. Pure. |
| `src/model/notEvaluated.ts` | What an opened, never-evaluated stack says, and its log link. Pure. |
| `src/model/layers.ts` | Grouping stacks by name prefix, and whether that helps. Pure. |
| `src/model/urlState.ts` | View state ⇄ URL hash. Pure, round-trip tested. |
| `src/nav/navigation.ts` | The host's hash and opening a page of Azure DevOps, with `window` fallbacks. |
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
