/**
 * View state ⇄ URL hash.
 *
 * Decision: a single resource is addressable by URL, so a reviewer can paste
 * "look at this Delete" into an approval thread. Defaults are omitted from the
 * encoding, so the default view has an empty hash and a shared link only ever
 * carries what the sender actually changed.
 *
 * In the extension the hash is owned by the host page, not by `window` — see
 * `src/nav/navigation.ts`. This module stays a pure string codec so both paths
 * share it and it can be round-trip tested.
 */
import { SEVERITIES, type Severity } from '@bicep-whatif/core';
import { DEFAULT_SEVERITIES, defaultViewState, isDefaultSeveritySet, type ViewState } from './view.js';

const SEVERITY_BY_NAME = new Map<string, Severity>(SEVERITIES.map((s) => [s.toLowerCase(), s]));

function list(keys: ReadonlySet<string>): string {
  return [...keys].sort().map(encodeURIComponent).join(',');
}

function decodeList(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((s) => decodeURIComponent(s))
      .filter((s) => s.length > 0),
  );
}

export function encodeViewState(state: ViewState): string {
  const parts: string[] = [];

  if (!isDefaultSeveritySet(state.severities)) {
    // Encode in ladder order so the same selection always produces the same string.
    const on = SEVERITIES.filter((s) => state.severities.has(s));
    parts.push(`sev=${on.join(',')}`);
  }
  if (state.stacks !== null) {
    parts.push(`stacks=${[...state.stacks].sort().map(encodeURIComponent).join(',')}`);
  }
  if (state.query.trim().length > 0) parts.push(`q=${encodeURIComponent(state.query.trim())}`);
  if (state.hideNoise) parts.push('hidenoise=1');
  if (state.layout === 'resources') parts.push('view=all');
  if (state.openStacks.size > 0) parts.push(`open=${list(state.openStacks)}`);
  // `encodeURIComponent` escapes commas, so a comma can only ever be ours.
  if (state.open.size > 0) parts.push(`sel=${list(state.open)}`);

  return parts.join('&');
}

/**
 * Tolerant by design. A hash is user-editable and arrives from wherever someone
 * pasted it, so an unrecognised key or an unknown severity is dropped rather
 * than throwing — but an unparseable hash must never silently widen the filter
 * into hiding something, so anything unrecognised falls back to the default.
 */
export function decodeViewState(hash: string): ViewState {
  const state = defaultViewState();
  const raw = hash.replace(/^#+/, '');
  if (raw.length === 0) return state;

  for (const part of raw.split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);

    switch (key) {
      case 'sev': {
        const wanted = new Set<Severity>();
        for (const token of value.split(',')) {
          const hit = SEVERITY_BY_NAME.get(decodeURIComponent(token).toLowerCase());
          if (hit) wanted.add(hit);
        }
        // An empty or entirely unrecognised set would show nothing at all, which
        // reads as "no changes". Fall back to the default rather than lie.
        state.severities = wanted.size > 0 ? wanted : new Set(DEFAULT_SEVERITIES);
        break;
      }
      case 'stacks': {
        const keys = value
          .split(',')
          .map((s) => decodeURIComponent(s))
          .filter((s) => s.length > 0);
        state.stacks = keys.length > 0 ? new Set(keys) : null;
        break;
      }
      case 'q':
        state.query = decodeURIComponent(value);
        break;
      case 'hidenoise':
        state.hideNoise = value === '1';
        break;
      // A link from before rows opened in place carries one key here, which
      // decodes as a list of one.
      case 'sel':
        state.open = decodeList(value);
        break;
      case 'open':
        state.openStacks = decodeList(value);
        break;
      case 'view':
        state.layout = value === 'all' ? 'resources' : 'stacks';
        break;
      default:
        break;
    }
  }
  return state;
}
