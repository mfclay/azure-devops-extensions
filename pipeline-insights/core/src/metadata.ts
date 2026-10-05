import { load } from 'js-yaml';

/**
 * A pipeline's purpose, owner, category and component, and whether it is archived, as its repo
 * documents them: an entry in the repo's `pipelines.meta.yaml`, keyed by the pipeline's YAML path.
 * The rules are in design.md, "Pipeline descriptions and owners".
 */

/** The metadata file's name. One per repo. */
export const CATALOG_NAME = 'pipelines.meta.yaml';

/** Where a repo's metadata file is looked for, in order: `pipelines/`, `.azuredevops/`, the root. */
export const CATALOG_FOLDERS: readonly string[] = ['pipelines', '.azuredevops', ''];

/** The fields an entry can set. `purpose` and `owner` are required, the rest optional. */
export interface MetadataFields {
  purpose?: string;
  owner?: string;
  category?: string;
  component?: string;
}

const KEYS: readonly (keyof MetadataFields)[] = ['purpose', 'owner', 'category', 'component'];

/** The file's top-level sections. Others are reserved for later, such as component definitions. */
const SECTIONS: readonly string[] = ['pipelines'];

export interface CatalogEntry {
  /** The YAML path as the file writes it, without a leading `/`. */
  path: string;
  fields: MetadataFields;
  /** Markdown shown below the purpose in the side panel, such as a runbook. */
  details?: string;
  /** `archived: true`: still listed, but it raises nothing and counts toward nothing. */
  archived?: boolean;
  /** Problems a reader should fix, as sentences. An entry with problems still supplies its fields. */
  problems: string[];
}

export interface ParsedCatalog {
  /** By `catalogKey()` of the YAML path. */
  entries: Map<string, CatalogEntry>;
  /** Problems with the file as a whole. */
  problems: string[];
}

/** How an entry's YAML path is matched to a definition's: no leading `/`, `/` separators, any case. */
export function catalogKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/**
 * A `pipelines.meta.yaml` file:
 *
 * ```yaml
 * pipelines:
 *   pipelines/web-app-build.yaml:
 *     owner: Platform Team
 *     purpose: >-
 *       Builds and pushes the web app image.
 * ```
 */
export function parseCatalog(text: string): ParsedCatalog {
  const entries = new Map<string, CatalogEntry>();
  const problems: string[] = [];
  if (!text.trim()) return { entries, problems: ['The file is empty.'] };
  let data: unknown;
  try {
    data = load(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n')[0] : '';
    return { entries, problems: [`The file is not valid YAML${reason ? `: ${reason}` : ''}.`] };
  }
  if (data == null) return { entries, problems: ['The file is empty.'] };
  if (!isRecord(data)) return { entries, problems: ['The file should be a set of sections, starting with `pipelines:`.'] };

  for (const section of Object.keys(data)) {
    if (!SECTIONS.includes(section)) problems.push(`Unknown section '${section}'.`);
  }
  const pipelines = data.pipelines;
  if (pipelines == null) {
    problems.push('The file has no `pipelines:` section.');
    return { entries, problems };
  }
  if (!isRecord(pipelines)) {
    problems.push('`pipelines:` should map each pipeline\'s YAML path to its fields.');
    return { entries, problems };
  }

  for (const [rawPath, value] of Object.entries(pipelines)) {
    const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const key = catalogKey(path);
    if (entries.has(key)) {
      problems.push(`'${path}' is listed twice; the first entry is used.`);
      continue;
    }
    const entry: CatalogEntry = { path, fields: {}, problems: [] };
    entries.set(key, entry);
    if (!/\.ya?ml$/i.test(path)) entry.problems.push(`'${path}' is not a YAML file's path.`);
    if (value == null) continue;
    if (!isRecord(value)) {
      entry.problems.push('The entry should be a list of `key: value` lines.');
      continue;
    }
    for (const [rawKey, field] of Object.entries(value)) {
      const name = rawKey.toLowerCase();
      if (field == null) continue;
      if (name === 'details') {
        if (typeof field === 'object') entry.problems.push("'details' should be text.");
        else entry.details = String(field).trim();
      } else if (name === 'archived') {
        if (typeof field !== 'boolean') entry.problems.push("'archived' should be true or false.");
        else if (field) entry.archived = true;
      } else if (!isKey(name)) entry.problems.push(`Unknown key '${name}'.`);
      else if (typeof field === 'object') entry.problems.push(`'${name}' should be text.`);
      else entry.fields[name] = String(field).trim();
    }
  }
  return { entries, problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKey(key: string): key is keyof MetadataFields {
  return (KEYS as readonly string[]).includes(key);
}

/** Where a pipeline's purpose came from, in the order they win. */
export type MetadataSource = 'catalog' | 'derived' | 'structural' | 'none';

export interface Metadata extends MetadataFields {
  source: MetadataSource;
  /** The purpose was marked `(TODO: verify)`: drafted, not yet confirmed. The mark is removed. */
  draft: boolean;
  /** An entry's Markdown after its purpose. */
  details?: string;
  archived?: boolean;
  problems: string[];
}

/** What the YAML and the runs show, for a pipeline nobody has described. */
export interface Structure {
  /** Pipelines whose completion starts this one. */
  runsAfter: readonly string[];
  /** The newest run's stages, in order. */
  stages: readonly string[];
}

/**
 * Which source wins, first match: the entry's purpose; the first paragraph of the YAML's
 * opening comment, marked derived; a structural summary; nothing. An owner comes only from an
 * entry, never from a guess, so an entry with an owner and no purpose keeps its owner.
 */
export function resolveMetadata(yaml: string | null, entry: CatalogEntry | null, structure: Structure): Metadata {
  const documented = {
    ...entry?.fields,
    problems: entry ? [...entry.problems] : [],
    ...(entry?.details ? { details: entry.details } : {}),
    ...(entry?.archived ? { archived: true } : {}),
  };
  if (documented.purpose) return finish({ ...documented, source: 'catalog' });

  const derived = yaml === null ? '' : openingParagraph(yaml);
  if (derived) return finish({ ...documented, source: 'derived', purpose: derived });

  const summary = structuralSummary(structure);
  if (summary) return finish({ ...documented, source: 'structural', purpose: summary });
  return finish({ ...documented, source: 'none' });
}

const DRAFT = /\s*\(TODO(?::[^)]*)?\)/gi;

/** Removes the draft mark, reads TODO as not set, and drops empty fields. */
function finish(m: Omit<Metadata, 'draft'>): Metadata {
  const out: Metadata = { ...m, draft: false };
  if (out.purpose !== undefined) {
    // Only the mark makes a draft: folding a long purpose over several lines does not.
    const unmarked = out.purpose.replace(DRAFT, '');
    out.draft = unmarked !== out.purpose;
    out.purpose = unmarked.replace(/\s+/g, ' ').trim();
  }
  for (const key of [...KEYS, 'details'] as const) {
    const value = out[key];
    if (value === undefined || !value.trim() || value.trim().toUpperCase() === 'TODO') delete out[key];
  }
  return out;
}

/**
 * The first paragraph of the comment block that opens the YAML, leaving out editor directives
 * such as `# yaml-language-server:`. A banner title, boxed between rules such as `# =====`, is
 * passed over for the paragraph under it.
 */
function openingParagraph(yaml: string): string {
  type Block = { lines: string[]; boxed: boolean };
  const blocks: Block[] = [];
  let current: Block | null = null;
  let afterRule = false;
  const close = (byRule: boolean) => {
    if (current) {
      current.boxed = current.boxed && byRule;
      blocks.push(current);
      current = null;
    }
  };
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed && !blocks.length && !current) continue;
    if (!trimmed.startsWith('#')) break;
    const text = trimmed.replace(/^#+\s?/, '').trim();
    if (/^yaml-language-server:/.test(text)) continue;
    const rule = Boolean(text) && !/[\p{L}\p{N}]/u.test(text);
    if (!text || rule) {
      close(rule);
      afterRule = rule;
      continue;
    }
    current ??= { lines: [], boxed: afterRule };
    current.lines.push(text);
  }
  close(false);
  const chosen = blocks.find((b) => !b.boxed) ?? blocks[0];
  return chosen ? chosen.lines.join(' ') : '';
}

function structuralSummary({ runsAfter, stages: all }: Structure): string {
  // A pipeline without stages runs in one implicit stage, `__default`.
  const stages = all.filter((s) => s !== '__default');
  const parts: string[] = [];
  if (runsAfter.length) parts.push(`Runs after ${runsAfter.join(' and ')}`);
  if (stages.length === 1) parts.push(`1 stage, ${stages[0]}`);
  else if (stages.length > 1) parts.push(`${stages.length} stages ending in ${stages[stages.length - 1]}`);
  return parts.join('; ');
}
