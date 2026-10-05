import type { BuildPolicy, Definition, FileEntry, Run, Timeline, TimelineRecord } from './source.js';

/**
 * Trim raw Azure DevOps responses to the types in `source.ts`.
 *
 * Every source runs its responses through these, so the extension, a capture and a fixture
 * replay all hand core the same shape. They also keep what core never reads out of a fixture:
 * definitions carry `authoredBy` and `properties`, runs carry `templateParameters` and
 * `requestedFor`, timeline records carry log URLs and issue text.
 */

type Raw = Record<string, unknown>;

function pick(raw: unknown, keys: readonly string[]): Raw {
  const out: Raw = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const key of keys) {
    const value = (raw as Raw)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function trimDefinition(raw: unknown): Definition {
  const d = pick(raw, ['id', 'name', 'path', 'queueStatus', 'triggers']);
  const r = raw as Raw;
  if (r.process) d.process = pick(r.process, ['type', 'yamlFilename']);
  if (r.repository) d.repository = pick(r.repository, ['id', 'name', 'type', 'defaultBranch']);
  return d as unknown as Definition;
}

export function trimRun(raw: unknown): Run {
  const run = pick(raw, [
    'id', 'buildNumber', 'status', 'result', 'reason', 'sourceBranch', 'sourceVersion',
    'queueTime', 'startTime', 'finishTime',
  ]);
  run.definition = pick((raw as Raw).definition, ['id']);
  return run as unknown as Run;
}

/**
 * Keeps the records an approval can be read from: stages, their direct children (an approval's
 * parent is one of these), and the approvals. Jobs and tasks, most of a timeline, go.
 */
export function trimTimeline(raw: unknown): Timeline {
  const records = ((raw as Raw | null)?.records ?? []) as Raw[];
  const stages = new Set(records.filter((r) => r.type === 'Stage').map((r) => r.id));
  return {
    records: records
      .filter((r) => r.type === 'Stage' || r.type === 'Checkpoint.Approval' || stages.has(r.parentId))
      .map((r) => pick(r, ['id', 'parentId', 'type', 'name', 'state', 'result', 'order']) as unknown as TimelineRecord),
  };
}

/** The policy type id of build validation. */
export const BUILD_VALIDATION_POLICY_TYPE = '0609b952-1397-4640-95ec-e00a01b2c241';

/** Trims a policy configuration, or returns undefined if it is not a build-validation policy. */
export function trimBuildPolicy(raw: unknown): BuildPolicy | undefined {
  const r = raw as Raw;
  if ((r.type as Raw | undefined)?.id !== BUILD_VALIDATION_POLICY_TYPE) return undefined;
  const policy = pick(r, ['id', 'isEnabled', 'isBlocking', 'isDeleted']);
  const settings = pick(r.settings, ['buildDefinitionId', 'displayName', 'filenamePatterns']);
  const scope = (r.settings as Raw | undefined)?.scope;
  if (Array.isArray(scope)) settings.scope = scope.map((s) => pick(s, ['repositoryId', 'refName', 'matchKind']));
  policy.settings = settings;
  return policy as unknown as BuildPolicy;
}

export function trimFileEntry(raw: unknown): FileEntry {
  return pick(raw, ['path', 'objectId', 'gitObjectType']) as unknown as FileEntry;
}
