import { load } from 'js-yaml';
import type { BuildPolicy, Definition } from './source.js';

/** What starts a pipeline, read from its YAML, its settings and the branch policies. */
export interface Triggers {
  /** One line per trigger, for display. Backticks mark names, branches and paths. */
  lines: string[];
  /** Nothing starts it but a person: no CI, PR, schedule or resource trigger. */
  manualOnly: boolean;
  /** Pipelines whose completion starts this one, by name. */
  runsAfter: string[];
  /** The CI trigger's path includes, empty when it has none or they cannot be read. */
  ciPaths: string[];
  /** Other repos whose pushes start this one, by resource name, such as `Shop/Orders.Deployment`. */
  otherRepos: string[];
}

const MAX_PATHS_SHOWN = 3;

type Node = Record<string, unknown>;

/**
 * Ported from the catalog generator's `describe_triggers`. `yaml` is null when the file could not
 * be read. `policies` is every build-validation policy in the project, or null when they could
 * not be read, in which case PR lines are dropped.
 */
export function parseTriggers(yaml: string | null, definition: Definition, policies: readonly BuildPolicy[] | null): Triggers {
  // Every YAML pipeline carries a stub CI trigger with `settingsSourceType` 2; it says nothing.
  const settings = ((definition.triggers ?? []) as Node[]).filter((t) => t.settingsSourceType !== 2);
  const settingsCi = settings.find((t) => t.triggerType === 'continuousIntegration');
  const settingsSchedules = settings.filter((t) => t.triggerType === 'schedule');
  const completions = settings.filter((t) => t.triggerType === 'buildCompletion');

  const lines: string[] = [];
  const runsAfter: string[] = [];
  let ciPaths: string[] = [];
  const otherRepos: string[] = [];
  const done = (): Triggers => ({ lines: lines.length ? lines : ['Manual only'], manualOnly: !lines.length, runsAfter, ciPaths, otherRepos });

  for (const c of completions) {
    const name = String((c.definition as Node | undefined)?.name ?? 'another pipeline');
    runsAfter.push(name);
  }
  const completionLines = completions.map(
    (c, i) => `After \`${runsAfter[i]}\` (pipeline settings): ${branchList(settingsBranches(c))}`,
  );

  if (yaml === null) {
    lines.push(...scheduleLines(settingsSchedules), ...completionLines);
    return lines.length ? done() : { lines: ['Unknown (YAML not found)'], manualOnly: false, runsAfter, ciPaths, otherRepos };
  }
  let doc: unknown;
  try {
    doc = load(yaml);
  } catch {
    return { lines: ['See YAML'], manualOnly: false, runsAfter, ciPaths, otherRepos };
  }
  if (!isNode(doc)) return { lines: ['See YAML'], manualOnly: false, runsAfter, ciPaths, otherRepos };

  // CI. No `trigger:` key at all means CI on every branch, not no CI.
  if (settingsCi) {
    const branches = settingsBranches(settingsCi);
    lines.push(`CI (pipeline settings): ${branches.length ? code(branches) : 'see settings'}`);
  } else if (!('trigger' in doc)) {
    lines.push('CI: any branch (no `trigger:` key)');
  } else if (!isOff(doc.trigger)) {
    lines.push(push('CI', doc.trigger));
    if (!isExpression(doc.trigger)) ciPaths = filters(doc.trigger).paths;
  }

  // PR. Azure Repos ignores YAML `pr:`; a PR runs a pipeline only through a build-validation policy.
  if (definition.repository?.type === 'TfsGit') {
    for (const p of policies ?? []) {
      if (p.settings.buildDefinitionId !== definition.id || !p.isEnabled || p.isDeleted) continue;
      const branches = (p.settings.scope ?? []).map((s) => (s.refName ?? '').replace(/^refs\/heads\//, ''));
      let line = `PR: ${branches.some(Boolean) ? code(branches) : 'any branch'}`;
      // Stored from the repo root, `/src/*`; shown as the YAML's path filters are written, `src/*`.
      const paths = (p.settings.filenamePatterns ?? []).map((f) => f.replace(/^(!?)\/+/, '$1'));
      if (paths.length) line += ` — paths ${code(paths)}`;
      lines.push(line);
    }
  } else if (!isOff(doc.pr)) {
    lines.push(push('PR', doc.pr));
  }

  // Schedules. A schedule set in the pipeline settings replaces the YAML ones.
  if (settingsSchedules.length) {
    lines.push(...scheduleLines(settingsSchedules));
  } else if (doc.schedules) {
    if (isExpression(doc.schedules) || !Array.isArray(doc.schedules)) lines.push('Schedule: see YAML');
    else {
      for (const s of doc.schedules as Node[]) {
        lines.push(`Schedule: \`${String(s.cron)}\` UTC${s.displayName ? ` ${String(s.displayName)}` : ''}`);
      }
    }
  }

  lines.push(...completionLines);
  const resources = doc.resources;
  if (isExpression(resources)) {
    lines.push('Resource triggers: see YAML');
  } else if (isNode(resources)) {
    for (const p of asList(resources.pipelines)) {
      const t = p.trigger;
      if (t === undefined || t === null || t === false || t === 'none') continue;
      // `source` may carry the definition's folder: \services\production\x-build
      const source = String(p.source ?? p.pipeline).split('\\').pop()!;
      runsAfter.push(source);
      const label = `After \`${source}\``;
      lines.push(t === true ? `${label}: any branch` : push(label, t));
    }
    for (const r of asList(resources.repositories)) {
      if (isOff(r.trigger)) continue;
      const repo = String(r.name ?? r.repository);
      otherRepos.push(repo);
      lines.push(push(`CI on \`${repo}\``, r.trigger));
    }
  }
  return done();
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asList(value: unknown): Node[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function isOff(node: unknown): boolean {
  return node === undefined || node === null || node === false || node === 'none';
}

function isExpression(node: unknown): boolean {
  return JSON.stringify(node ?? null).includes('${{');
}

function code(items: readonly string[]): string {
  const shown = items.slice(0, MAX_PATHS_SHOWN).map((i) => `\`${i}\``).join(', ');
  const extra = items.length - MAX_PATHS_SHOWN;
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

function branchList(branches: readonly string[]): string {
  return branches.length === 0 || (branches.length === 1 && branches[0] === '*') ? 'any branch' : code(branches);
}

/** Branches and paths from a trigger node: a list of branches, or a mapping. */
function filters(node: unknown): { branches: string[]; paths: string[] } {
  if (Array.isArray(node)) return { branches: node.map(String), paths: [] };
  if (!isNode(node)) return { branches: ['*'], paths: [] };
  let branches = node.branches ?? ['*'];
  if (isNode(branches)) branches = branches.include ?? ['*'];
  let paths = node.paths ?? [];
  if (isNode(paths)) paths = paths.include ?? [];
  return {
    branches: Array.isArray(branches) ? branches.map(String) : [String(branches)],
    paths: Array.isArray(paths) ? paths.map(String) : [],
  };
}

function push(label: string, node: unknown): string {
  if (isExpression(node)) return `${label}: see YAML`;
  const { branches, paths } = filters(node);
  return `${label}: ${branchList(branches)}${paths.length ? ` — paths ${code(paths)}` : ''}`;
}

function settingsBranches(trigger: Node): string[] {
  return ((trigger.branchFilters as string[] | undefined) ?? []).map((b) => b.replace(/^\+/, '').replace(/^refs\/heads\//, ''));
}

function scheduleLines(triggers: readonly Node[]): string[] {
  const schedules = (triggers[0]?.schedules as Node[] | undefined) ?? [];
  return schedules.map((s) => {
    const hh = String(s.startHours ?? 0).padStart(2, '0');
    const mm = String(s.startMinutes ?? 0).padStart(2, '0');
    return `Schedule (pipeline settings): ${hh}:${mm} ${String(s.timeZoneId ?? '')}, ${String(s.daysToBuild ?? '')}`;
  });
}
