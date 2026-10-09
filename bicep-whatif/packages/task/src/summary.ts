/**
 * What the build log and the build summary page show.
 *
 * This is decision **D2**'s payoff made visible: severity here is
 * `@bicep-whatif/core`'s four-axis collapse, the same function the tab
 * calls, so the log and the tab cannot rank the same run differently. Nothing in
 * this file re-implements the ladder — if a rung is wrong, it is wrong in
 * `core`, and it is wrong in both places at once, which is the property worth
 * having.
 *
 * The markdown roll-up matters beyond convenience. An organisation that installs
 * the task but not the tab, or a reader without access to the tab, still gets
 * the ranked run from this summary. It costs one attachment.
 */
import {
  needsAttention,
  normalizeStackWhatIf,
  SEVERITIES,
  SEVERITY_GLYPH,
  SEVERITY_RANK,
  compareBySeverityDesc,
  type NormalizedStackWhatIf,
  type ResourceRow,
  type Severity,
} from '@bicep-whatif/core';

/** Most dangerous first, and never `noChange` — that rung is the whole point of filtering. */
const REPORTED: readonly Severity[] = [...SEVERITIES]
  .filter((s) => s !== 'noChange')
  .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);

export interface SummaryContext {
  stackId: string;
  stackName: string | undefined;
  layer: number | undefined;
  status: string;
  resultName: string | undefined;
}

/** Cap the per-row detail. A stack with 400 modifies should not own the log. */
const MAX_ROWS = 60;

function label(row: ResourceRow): string {
  const type = row.resourceType.length > 0 ? row.resourceType : 'resource';
  return `${row.name} (${type})`;
}

/**
 * The "why" line, printed only when the ranking is not what the change type
 * alone would predict. The tab makes the same choice for the same reason:
 * printing a reason on two hundred routine rows trains people to stop reading
 * the line, and then the one row that matters gets skipped with the rest.
 */
function surprisingReason(row: ResourceRow): string | undefined {
  const predicted = row.changeType.toLowerCase();
  const rung = row.severity.toLowerCase();
  const unsurprising =
    (predicted === 'delete' && rung === 'destructive') ||
    (predicted === 'detach' && rung === 'protectionloss') ||
    (predicted === 'create' && rung === 'create') ||
    (predicted === 'modify' && rung === 'modify') ||
    (predicted === 'nochange' && rung === 'nochange');
  if (unsurprising) return undefined;
  return row.severityReasons[0]?.detail;
}

export interface RenderedSummary {
  /** Plain text for the build log. */
  log: string;
  /** Markdown for a `Distributedtask.Core.Summary` attachment. */
  markdown: string;
  /** Counts by rung, for the one-line result message. */
  counts: Readonly<Record<Severity, number>>;
  highestSeverity: Severity | undefined;
  warnings: string[];
  /** Azure's warnings and errors about this what-if, one line each, for the pipeline's issues. */
  diagnostics: string[];
}

export function renderSummary(payload: unknown, context: SummaryContext): RenderedSummary {
  const normalized: NormalizedStackWhatIf = normalizeStackWhatIf(payload);
  const rows = [...normalized.rows].sort(compareBySeverityDesc);
  const interesting = rows.filter((r) => r.severity !== 'noChange');

  const heading = context.stackName ?? context.stackId;
  const layerNote = context.layer !== undefined ? ` · layer ${context.layer}` : '';

  const tally = REPORTED.map((s) => `${SEVERITY_GLYPH[s]} ${normalized.counts[s]} ${s}`).join('   ');
  const noChange = normalized.counts.noChange;

  const logLines: string[] = [
    `${heading}${layerNote} — ${context.status}`,
    `${normalized.total} resource${normalized.total === 1 ? '' : 's'} evaluated`,
    tally,
    `* ${noChange} noChange`,
  ];

  const mdLines: string[] = [
    `## ${heading}`,
    '',
    `\`${context.status}\`${layerNote ? ` ·${layerNote.slice(2)}` : ''} · ` +
      `${normalized.total} resource${normalized.total === 1 ? '' : 's'} evaluated`,
    '',
    '| | Rung | Count |',
    '|---|---|---|',
    ...REPORTED.map((s) => `| \`${SEVERITY_GLYPH[s]}\` | ${s} | ${normalized.counts[s]} |`),
    `| \`*\` | noChange | ${noChange} |`,
    '',
  ];

  // Azure's own word that the result may be incomplete: a short-circuited
  // module is missing from the rows above and named only here. So these come
  // before the rows, not after them.
  const attention = normalized.diagnostics.filter(needsAttention);
  const diagnostics = attention.map((d) => `${d.code ?? d.level}: ${d.message}`);
  if (normalized.diagnostics.length > 0) {
    logLines.push('', `Azure diagnostics (${normalized.diagnostics.length}):`);
    for (const d of normalized.diagnostics) {
      const code = d.code !== undefined ? ` ${d.code}` : '';
      logLines.push(`  ${needsAttention(d) ? '!' : 'i'} ${d.level}${code}: ${d.message}`);
    }
  }
  if (attention.length > 0) {
    mdLines.push(
      `> **Azure reported ${attention.length} warning${attention.length === 1 ? '' : 's'} on this what-if.** ` +
        'Resources can be missing from the result, or predicted without certainty.',
      '>',
      ...attention.map((d) => `> - \`${d.code ?? d.level}\`: ${d.message}`),
      '',
    );
  }

  if (interesting.length === 0) {
    logLines.push('', 'Nothing above noChange.');
    mdLines.push('Nothing above `noChange`.', '');
  } else {
    const shown = interesting.slice(0, MAX_ROWS);
    logLines.push('');
    mdLines.push('| | Resource | Change | Why |', '|---|---|---|---|');
    for (const row of shown) {
      const glyph = SEVERITY_GLYPH[row.severity];
      const why = surprisingReason(row);
      logLines.push(`  ${glyph} ${label(row)}${why !== undefined ? `  — ${why}` : ''}`);
      mdLines.push(
        `| \`${glyph}\` | \`${row.name}\` | ${row.changeType} | ${why ?? ''} |`.replace(
          /\|\s*\|/g,
          '| |',
        ),
      );
    }
    if (interesting.length > shown.length) {
      const rest = interesting.length - shown.length;
      logLines.push(`  … and ${rest} more. The full set is in the attachment.`);
      mdLines.push('', `_…and ${rest} more. The full set is in the attachment._`);
    }
    mdLines.push('');
  }

  // Coping is not hiding. Anything the parser worked around is shown, never
  // swallowed — zero rows plus zero warnings means a genuinely clean stack, and
  // zero rows plus a warning means something else entirely.
  const warnings = normalized.warnings.map((w) =>
    w.at !== undefined ? `${w.message} (at ${w.at})` : w.message,
  );
  if (warnings.length > 0) {
    logLines.push('', `${warnings.length} parse warning${warnings.length === 1 ? '' : 's'}:`);
    for (const w of warnings.slice(0, 20)) logLines.push(`  ! ${w}`);
    mdLines.push(
      `> **${warnings.length} parse warning${warnings.length === 1 ? '' : 's'}.** ` +
        'The payload held something this build did not recognise; it is rendered as itself ' +
        'rather than dropped.',
      '',
    );
  }

  return {
    log: logLines.join('\n'),
    markdown: mdLines.join('\n'),
    counts: normalized.counts,
    highestSeverity: normalized.highestSeverity,
    warnings,
    diagnostics,
  };
}

/** The one-line result the pipeline shows beside the task name. */
export function resultLine(summary: RenderedSummary): string {
  const parts = REPORTED.filter((s) => summary.counts[s] > 0).map(
    (s) => `${summary.counts[s]} ${s}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'no changes above noChange';
}
