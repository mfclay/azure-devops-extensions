/**
 * Azure's diagnostics on a stack's what-if, said in plain words.
 *
 * Azure writes its warnings for a log: `RESULT NON-DETERMINISTIC! UNMARKED
 * RESOURCES COULD BE DELETED. One or more resource ids short-circuited…`,
 * truncated on a stack line, reads as an alarm nobody can act on. So a code
 * this tab knows gets one sentence of its own, and any other code falls back to
 * the first sentence of Azure's message. Azure's full text stays one click away
 * in the opened stack.
 *
 * Plain is not quieter. A warning still appears on the closed stack line, and
 * where Azure says resources could be deleted, so does the sentence.
 */
import { needsAttention, type WhatIfDiagnostic } from '@bicep-whatif/core';
import type { StackView } from './estate.js';
import { stackWarnings } from './summary.js';

const SHORT_CIRCUIT = 'shortcircuitedresourceid';

function isShortCircuit(d: WhatIfDiagnostic): boolean {
  return d.code?.toLowerCase() === SHORT_CIRCUIT;
}

/** Whether any row in the stack is one Azure marked potential. */
function hasPotential(stack: StackView): boolean {
  return Object.values(stack.potentialCounts).some((n) => n > 0);
}

/**
 * The first sentence of a message, in sentence case when Azure shouted it.
 * Mixed case is left alone: it may hold names whose case matters.
 */
export function firstSentence(message: string): string {
  const trimmed = message.trim();
  const match = /^(.+?[.!?])(\s|$)/s.exec(trimmed);
  const sentence = (match?.[1] ?? trimmed).trim();
  const letters = sentence.replace(/[^A-Za-z]/g, '');
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    const lower = sentence.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return sentence;
}

/**
 * One line per warning for the closed stack line, said once per code.
 *
 * A short-circuit leaves Azure unable to rule out deletes, and when it marked
 * any row potential the line says so, because that is what Azure's own message
 * leads with.
 */
export function warningLines(stack: StackView): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of stackWarnings(stack)) {
    const key = d.code?.toLowerCase() ?? `#${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isShortCircuit(d)) {
      out.push(
        hasPotential(stack)
          ? "Result may be incomplete — Azure couldn't resolve a resource id, so it can't rule out deletes."
          : "Result may be incomplete — Azure couldn't resolve a resource id before the deploy.",
      );
    } else {
      out.push(firstSentence(d.message));
    }
  }
  return out;
}

export interface Callout {
  title: string;
  body: string;
}

/**
 * What the opened stack says first when Azure warned about it, before Azure's
 * own text. Undefined when there is no warning.
 *
 * Azure does not say how many ids short-circuited ("one or more"), so neither
 * does this.
 */
export function incompleteCallout(stack: StackView): Callout | undefined {
  const warnings = stackWarnings(stack);
  if (warnings.length === 0) return undefined;
  if (warnings.some(isShortCircuit)) {
    return {
      title: "This result isn't complete.",
      body:
        "Azure couldn't resolve one or more resource ids before the deploy. Any resource in this stack " +
        'without a definite change is listed as a potential detach or delete — it may or may not happen.',
    };
  }
  return {
    title: 'Azure warned this result may be incomplete.',
    body: warnings.map((d) => firstSentence(d.message)).join(' '),
  };
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The disclosure that opens Azure's full text: "Show Azure's message (1 warning, 1 info)". */
export function diagnosticsDisclosure(diagnostics: readonly WhatIfDiagnostic[]): string {
  const byLevel = new Map<string, number>();
  for (const d of diagnostics) {
    const level = needsAttention(d) ? d.level.toLowerCase() : 'info';
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  const order = ['error', 'warning', ...[...byLevel.keys()].filter((k) => !['error', 'warning', 'info'].includes(k)), 'info'];
  const parts: string[] = [];
  for (const level of order) {
    const n = byLevel.get(level);
    if (n === undefined) continue;
    parts.push(level === 'info' ? `${String(n)} info` : plural(n, level, `${level}s`));
  }
  const noun = diagnostics.length === 1 ? 'message' : 'messages';
  return `Show Azure's ${noun} (${parts.join(', ')})`;
}
