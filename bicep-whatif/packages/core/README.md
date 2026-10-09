# `@bicep-whatif/core`

Turns an Azure Deployment Stacks what-if payload into rows a UI can rank.

No React, no Azure DevOps SDK, no styling, no network. Six UX decisions about the
grid are still open and this package has to survive all of them, so it stays
UI-agnostic on purpose.

```ts
import { normalizeEstate, compareBySeverityDesc, SEVERITY_GLYPH } from '@bicep-whatif/core';

const estate = normalizeEstate([networkPayload, sharedInfraPayload]);

for (const row of [...estate.rows].sort(compareBySeverityDesc)) {
  console.log(SEVERITY_GLYPH[row.severity], row.severity, row.stackName, row.name);
  console.log('   ', row.severityReasons[0]?.detail);
}
```

## The severity ladder

Stack what-if reports four axes per resource — change type, management status,
deny status, and the property delta. **Severity is the maximum across all four**,
not a lookup on change type. That is the entire reason `severityOf()` exists rather
than a sort on `changeType`.

| Rung | Glyph | Reached by |
|---|---|---|
| `destructive` | `-` | `delete` |
| `protectionLoss` | `/` | `detach`, management status → `notManaged`, deny mode weakening |
| `create` | `+` | `create` |
| `modify` | `~` | `modify` |
| `unevaluated` | `?` | `unsupported`, or a change type this build does not recognise |
| `noChange` | `*` | `noChange` |

The task's build log and summary print the same glyphs, from this same table, so
the tab reads continuously with the log people already know.

### Why the axes have to collapse

A resource can lose protection with no property change and no interesting change
type at all:

```ts
severityOf({
  changeType: parseResourceChangeType('noChange'),
  managementStatus: { before: parseManagementStatus('managed'),
                      after:  parseManagementStatus('notManaged') },
}).severity;                                    // 'protectionLoss', not 'noChange'
```

Sorted on `changeType` that row sits at the bottom of the table next to two hundred
benign no-ops. It is the stack quietly stopping to govern a key vault.

### Why `unevaluated` exists

It is not in the original five-rung sketch, and it is load-bearing. A UI hides
`noChange` by default. Anything that could not be evaluated — an `unsupported`
resource, or a change type written by a schema newer than this build — must not be
swept up by a filter meant for resources *known* to be fine. So it gets its own
rung, immediately above `noChange`.

The same rung is where a consumer should put a pipeline stage that produced no
attachment at all. **Absence of data must never render as absence of change.**

## Parsing is defensive, but never quiet

Two rules, and they pull in opposite directions on purpose:

1. **Nothing throws.** `normalizeStackWhatIf()` returns a result for any input —
   `null`, a string, a number, a payload from a future schema. An unrecognised enum
   value is kept verbatim with `known: false` and rendered as itself. A viewer that
   dies on one unexpected field fails exactly when the payload is unusual, which is
   exactly when someone needs to look at it.
2. **Coping is not hiding.** Everything the parser worked around comes back in
   `warnings`, and anything unevaluated ranks above `noChange`. Zero rows plus zero
   warnings means a genuinely clean stack; zero rows plus a warning means something
   else, and the caller must be able to tell the difference.

Azure's own `properties.diagnostics` come back whole, as `diagnostics`, and change
no row's rank. They matter for the same rule: a module whose id cannot be worked
out before the deploy is short-circuited, left out of `resourceChanges`, and named
only there. Anything but an `info` needs a consumer to say so.

Enum matching is case-insensitive, which is required rather than decorative: one
real capture disagrees with itself, carrying `denySettings.mode: "none"` and
`changes.denySettingsChange.before.mode: "None"` in the same file.

## API

| Export | Purpose |
|---|---|
| `normalizeStackWhatIf(payload)` | One stack → `NormalizedStackWhatIf` |
| `normalizeEstate(payloads)` | N stacks → `NormalizedEstate`, rows tagged by stack |
| `severityOf(input)` | The four-axis collapse, with reasons |
| `compareBySeverityDesc(a, b)` | Sort comparator, most dangerous first |
| `flattenPropertyChanges(tree)` | Delta tree → dotted paths, for search |
| `needsAttention(diagnostic)` / `diagnosticsFor(diagnostics, row)` | Which of Azure's diagnostics to raise, and which name a row |
| `isManagementLost` / `isDenyWeakened` | The two protection-loss predicates |
| `parse*` / `denyStrength` | Case-insensitive enum readers |
| `SEVERITY_RANK` / `SEVERITY_GLYPH` / `SEVERITY_TONE` | Presentation-neutral metadata |

`stackName` comes off `deploymentStackResourceId`, **not** off the payload's
`name`. `name` is the transient what-if *result* resource, named
`whatif-{stackId}-{buildId}`, so it changes every run — grouping on it would
splinter one stack into one bucket per build. `resultName` keeps it for provenance.

## Payload mapping

Stack what-if is not deployment what-if with different words. The shapes are
incompatible:

| Deployment what-if | Stack what-if |
|---|---|
| `status` | `properties.provisioningState` |
| `changes[]` | `properties.changes.resourceChanges[]` |
| `.resourceId` | `.id` |
| `.before` / `.after` / `.delta` | `.resourceConfigurationChanges.{before,after,delta}` |
| `delta[].propertyChangeType` | `delta[].changeType` |
| — | `.managementStatusChange` · `.denyStatusChange` |

The property-level `changeType` is a **different enum** from the resource-level
one: it adds `array` and `noEffect` and drops `detach` and `noChange`. Both extra
values appear in the real captures. `children` nests — three levels deep in build
7700017.

## Tests

```bash
npm test        # 46 tests
npm run build
```

Against the real captures from build 7700017 plus the synthetic `Detach` / `Delete`
cases no live stack produces. See [`fixtures/README.md`](fixtures/README.md) for
provenance and the scrubbing record.
