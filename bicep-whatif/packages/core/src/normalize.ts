/**
 * Raw ARM payload -> rows a UI can rank.
 *
 * The governing rule: **this never throws on a malformed payload.** Every branch
 * that could fail instead records a `ParseWarning` and carries on with whatever it
 * could recover. A viewer that dies on one unexpected field is worse than useless
 * at a deploy gate, because it fails exactly when the payload is unusual — which
 * is exactly when someone needs to look at it.
 *
 * The corollary, and it matters just as much: coping is not the same as hiding.
 * Nothing is dropped silently. Anything the parser had to work around comes back
 * in `warnings`, and anything it could not evaluate ranks as `unevaluated`, above
 * `noChange`, so a default filter cannot bury it.
 */
import {
  parseDenyStatus,
  parseManagementStatus,
  parsePropertyChangeType,
  parseResourceChangeType,
  type DenyStatus,
  type ManagementStatus,
  type Parsed,
  type ResourceChangeType,
} from './enums.js';
import type {
  DenySettings,
  NormalizedEstate,
  NormalizedStackWhatIf,
  ParseWarning,
  PropertyChange,
  ResourceRow,
  StatusTransition,
  WhatIfDiagnostic,
} from './model.js';
import type { RawResourceChange, RawStackWhatIfResult } from './raw.js';
import {
  isDenyWeakened,
  isManagementLost,
  severityOf,
  SEVERITIES,
  SEVERITY_RANK,
  type Severity,
} from './severity.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

function emptyCounts(): Record<Severity, number> {
  const c = {} as Record<Severity, number>;
  for (const s of SEVERITIES) c[s] = 0;
  return c;
}

function highestOf(counts: Record<Severity, number>): Severity | undefined {
  let best: Severity | undefined;
  for (const s of SEVERITIES) {
    if (counts[s] > 0 && (best === undefined || SEVERITY_RANK[s] > SEVERITY_RANK[best])) best = s;
  }
  return best;
}

/** Pull subscription / resource group / name out of an ARM id without a regex zoo. */
function dissectResourceId(id: string): {
  name: string;
  subscriptionId: string | undefined;
  resourceGroup: string | undefined;
} {
  const segments = id.split('/').filter(Boolean);
  const at = (key: string): string | undefined => {
    const i = segments.findIndex((s) => s.toLowerCase() === key);
    return i >= 0 ? segments[i + 1] : undefined;
  };
  return {
    name: segments[segments.length - 1] ?? '',
    subscriptionId: at('subscriptions'),
    resourceGroup: at('resourcegroups'),
  };
}

function parseStatusTransition<T extends string>(
  raw: unknown,
  parse: (v: unknown) => Parsed<T> | undefined,
  warnings: ParseWarning[],
  code: ParseWarning['code'],
  at: string,
): StatusTransition<T> {
  if (!isObject(raw)) return { before: undefined, after: undefined };
  const before = parse(raw['before']);
  const after = parse(raw['after']);
  for (const [side, p] of [
    ['before', before],
    ['after', after],
  ] as const) {
    if (p && !p.known) {
      warnings.push({ code, message: `Unrecognised ${side} value "${p.value}".`, at });
    }
  }
  return { before, after };
}

/** Walk the delta tree. `children` nests — three levels deep in real captures. */
function normalizeDelta(raw: unknown, warnings: ParseWarning[], at: string, depth = 0): PropertyChange[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push({ code: 'deltaNotArray', message: 'Property delta was not an array; ignored.', at });
    return [];
  }
  // A guard, not a limit anyone should hit. ARM deltas are a handful of levels;
  // anything deeper is a cycle or a malformed payload, and recursing into it would
  // hang the tab rather than degrade it.
  if (depth > 64) {
    warnings.push({ code: 'deltaNotArray', message: 'Property delta nested beyond 64 levels; truncated.', at });
    return [];
  }

  const out: PropertyChange[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const parsed = parsePropertyChangeType(entry['changeType']);
    if (parsed && !parsed.known) {
      warnings.push({
        code: 'unknownPropertyChangeType',
        message: `Unrecognised property change type "${parsed.value}".`,
        at: `${at}#${asString(entry['path']) ?? '?'}`,
      });
    }
    out.push({
      path: asString(entry['path']) ?? '',
      changeType: parsed?.value ?? '',
      changeTypeKnown: parsed?.known ?? false,
      before: entry['before'] ?? null,
      after: entry['after'] ?? null,
      children: normalizeDelta(entry['children'], warnings, at, depth + 1),
    });
  }
  return out;
}

function normalizeResourceChange(raw: RawResourceChange, warnings: ParseWarning[]): ResourceRow {
  const resourceId = asString(raw.id) ?? '';
  if (resourceId === '') {
    warnings.push({ code: 'missingResourceId', message: 'Resource change had no id.' });
  }
  const at = resourceId || '(unidentified resource)';
  const { name, subscriptionId, resourceGroup } = dissectResourceId(resourceId);

  const changeType = parseResourceChangeType(raw.changeType);
  if (changeType && !changeType.known) {
    warnings.push({
      code: 'unknownChangeType',
      message: `Unrecognised change type "${changeType.value}". Rendered as-is, ranked as unevaluated.`,
      at,
    });
  }

  const managementStatus = parseStatusTransition<ManagementStatus>(
    raw.managementStatusChange,
    parseManagementStatus,
    warnings,
    'unknownManagementStatus',
    at,
  );
  const denyStatus = parseStatusTransition<DenyStatus>(
    raw.denyStatusChange,
    parseDenyStatus,
    warnings,
    'unknownDenyStatus',
    at,
  );

  const config = isObject(raw.resourceConfigurationChanges) ? raw.resourceConfigurationChanges : undefined;

  const verdict = severityOf({ changeType, managementStatus, denyStatus });

  return {
    resourceId,
    name,
    resourceType: asString(raw.type) ?? '',
    subscriptionId,
    // ARM sometimes carries an explicit resourceGroup field; the id is the fallback.
    resourceGroup: asString(raw.resourceGroup) ?? resourceGroup,
    changeType: (changeType?.value as ResourceChangeType | string | undefined) ?? '',
    changeTypeKnown: changeType?.known ?? false,
    severity: verdict.severity,
    severityRank: verdict.rank,
    severityReasons: verdict.reasons,
    managementStatus,
    denyStatus,
    managementLost: isManagementLost(managementStatus.before, managementStatus.after),
    denyWeakened: isDenyWeakened(denyStatus.before, denyStatus.after),
    before: config?.['before'] ?? null,
    after: config?.['after'] ?? null,
    propertyChanges: normalizeDelta(config?.['delta'], warnings, at),
    symbolicName: asString(raw.symbolicName),
    apiVersion: asString(raw.apiVersion),
    changeCertainty: asString(raw.changeCertainty),
    unsupportedReason: asString(raw.unsupportedReason),
  };
}

function normalizeDenySettings(raw: unknown): DenySettings | undefined {
  if (!isObject(raw)) return undefined;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    mode: parseDenyStatus(raw['mode']),
    applyToChildScopes: typeof raw['applyToChildScopes'] === 'boolean' ? raw['applyToChildScopes'] : undefined,
    excludedActions: strArray(raw['excludedActions']),
    excludedPrincipals: strArray(raw['excludedPrincipals']),
  };
}

const DIAGNOSTIC_LEVELS: ReadonlySet<string> = new Set(['info', 'warning', 'error']);

/**
 * `properties.diagnostics`, kept whole and in order. An entry that is not an
 * object is skipped with a warning; an unknown level is kept as itself.
 */
function normalizeDiagnostics(raw: unknown, warnings: ParseWarning[]): WhatIfDiagnostic[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push({ code: 'diagnosticsNotArray', message: '`properties.diagnostics` was not an array.' });
    return [];
  }
  const out: WhatIfDiagnostic[] = [];
  for (const d of raw) {
    if (!isObject(d)) {
      warnings.push({ code: 'diagnosticNotObject', message: 'Skipped a non-object diagnostic.' });
      continue;
    }
    const level = asString(d['level']) ?? '';
    const levelKnown = DIAGNOSTIC_LEVELS.has(level.toLowerCase());
    if (!levelKnown) {
      warnings.push({
        code: 'unknownDiagnosticLevel',
        message: `Unrecognised diagnostic level "${level}". Shown as needing attention.`,
      });
    }
    const code = asString(d['code']);
    out.push({
      level: levelKnown ? level.toLowerCase() : level,
      levelKnown,
      code,
      message: asString(d['message']) ?? code ?? 'Azure attached a diagnostic with no message.',
      target: asString(d['target']),
    });
  }
  return out;
}

/**
 * Whether a diagnostic says the result may be incomplete or wrong: a warning, an
 * error, or a level this build does not know. Only `info` is safe to leave quiet.
 */
export function needsAttention(diagnostic: WhatIfDiagnostic): boolean {
  return diagnostic.level !== 'info';
}

/**
 * The diagnostics whose target is this resource, matched on its id without
 * regard to case. Nothing documents what a target holds, so a diagnostic that
 * matches no row stays with the stack rather than being guessed onto one.
 */
export function diagnosticsFor(
  diagnostics: readonly WhatIfDiagnostic[],
  row: Pick<ResourceRow, 'resourceId'>,
): WhatIfDiagnostic[] {
  if (row.resourceId.length === 0) return [];
  const id = row.resourceId.toLowerCase();
  return diagnostics.filter((d) => d.target?.toLowerCase() === id);
}

/**
 * Normalize one stack's what-if payload.
 *
 * Accepts the whole SDK resource as `az stack-whatif ... --no-pretty-print` emits
 * it. Returns a result for any input, including `null` — a payload that could not
 * be read produces zero rows and a warning saying so, which a caller must render
 * as "not evaluated" rather than as "no changes".
 */
export function normalizeStackWhatIf(payload: RawStackWhatIfResult | unknown): NormalizedStackWhatIf {
  const warnings: ParseWarning[] = [];
  const root = isObject(payload) ? payload : {};
  if (!isObject(payload)) {
    warnings.push({ code: 'missingProperties', message: 'Payload was not an object.' });
  }

  const props = isObject(root['properties']) ? root['properties'] : undefined;
  if (props === undefined && isObject(payload)) {
    warnings.push({ code: 'missingProperties', message: 'Payload had no `properties` object.' });
  }

  const changes = props && isObject(props['changes']) ? props['changes'] : undefined;
  if (props !== undefined && changes === undefined) {
    warnings.push({ code: 'missingChanges', message: 'Payload had no `properties.changes` object.' });
  }

  const rawChanges = changes?.['resourceChanges'];
  let rows: ResourceRow[] = [];
  if (rawChanges === undefined || rawChanges === null) {
    // `changes` present but no `resourceChanges` is not the same as "no changes".
    // Without this warning the caller gets zero rows and nothing to distinguish a
    // genuinely clean stack from a payload that never carried the list.
    if (changes !== undefined) {
      warnings.push({
        code: 'missingChanges',
        message: '`properties.changes` carried no `resourceChanges` list.',
      });
    }
  } else {
    if (!Array.isArray(rawChanges)) {
      warnings.push({
        code: 'resourceChangesNotArray',
        message: '`properties.changes.resourceChanges` was not an array.',
      });
    } else {
      rows = rawChanges
        .filter((c) => {
          if (isObject(c)) return true;
          warnings.push({ code: 'resourceChangeNotObject', message: 'Skipped a non-object resource change.' });
          return false;
        })
        .map((c) => normalizeResourceChange(c as RawResourceChange, warnings));
    }
  }

  const counts = emptyCounts();
  for (const r of rows) counts[r.severity] += 1;

  const diagnostics = normalizeDiagnostics(props?.['diagnostics'], warnings);

  // The stack-scoped deny change, which is not any one resource's deny status.
  const denyChange = changes && isObject(changes['denySettingsChange']) ? changes['denySettingsChange'] : undefined;
  const denyBefore = isObject(denyChange?.['before']) ? parseDenyStatus(denyChange['before']['mode']) : undefined;
  const denyAfter = isObject(denyChange?.['after']) ? parseDenyStatus(denyChange['after']['mode']) : undefined;

  const stackResourceId = asString(props?.['deploymentStackResourceId']);
  const actionOnUnmanage = isObject(props?.['actionOnUnmanage'])
    ? (Object.fromEntries(
        Object.entries(props['actionOnUnmanage']).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>)
    : undefined;

  return {
    // The stack name comes off `deploymentStackResourceId`, NOT off `root.name`.
    // `root.name` names the what-if *result* resource, which decision C3 names
    // `whatif-{stackId}-{Build.BuildId}` — it changes every run, so grouping or
    // filtering on it would splinter one stack into one bucket per build.
    stackName: (stackResourceId ? dissectResourceId(stackResourceId).name : undefined) ?? asString(root['name']),
    resultName: asString(root['name']),
    stackResourceId,
    provisioningState: asString(props?.['provisioningState']),
    correlationId: asString(props?.['correlationId']),
    actionOnUnmanage,
    denySettings: normalizeDenySettings(props?.['denySettings']),
    retentionInterval: asString(props?.['retentionInterval']),
    denySettingsWeakened: isDenyWeakened(denyBefore, denyAfter),
    rows,
    counts,
    total: rows.length,
    highestSeverity: highestOf(counts),
    diagnostics,
    warnings,
  };
}

/**
 * Normalize N stacks and aggregate them.
 *
 * The aggregate exists because severity, not stack, is the default spine: grouping
 * by stack first buries a single Delete in stack seven under two hundred benign
 * Modifys in stack one. `rows` here is the cross-stack list, each row tagged with
 * its stack so stack can still be a filter.
 */
export function normalizeEstate(payloads: readonly unknown[]): NormalizedEstate {
  const stacks = payloads.map((p) => normalizeStackWhatIf(p));
  const rows = stacks.flatMap((s) => s.rows.map((r) => ({ ...r, stackName: s.stackName })));
  const counts = emptyCounts();
  for (const r of rows) counts[r.severity] += 1;
  return {
    stacks,
    rows,
    counts,
    total: rows.length,
    highestSeverity: highestOf(counts),
    warnings: stacks.flatMap((s) => s.warnings),
  };
}

/** Flatten a property-delta tree to dotted paths — for search and plain-list rendering. */
export function flattenPropertyChanges(
  changes: readonly PropertyChange[],
  prefix = '',
): { path: string; changeType: string; changeTypeKnown: boolean; before: unknown; after: unknown }[] {
  const out: ReturnType<typeof flattenPropertyChanges> = [];
  for (const c of changes) {
    const path = prefix && c.path ? `${prefix}.${c.path}` : prefix || c.path;
    out.push({
      path,
      changeType: c.changeType,
      changeTypeKnown: c.changeTypeKnown,
      before: c.before,
      after: c.after,
    });
    if (c.children.length > 0) out.push(...flattenPropertyChanges(c.children, path));
  }
  return out;
}
