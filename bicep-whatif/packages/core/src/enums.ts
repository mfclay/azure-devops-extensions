/**
 * The four axes, and how to read them off a payload without trusting it.
 *
 * Every parser here follows the same contract: recognise a value case-insensitively,
 * return it in canonical camelCase, and when it is not recognised **return it
 * unchanged with `known: false`** rather than throwing or coercing it to a default.
 * An unrecognised value is a fact about the payload, not an error — the extension
 * has to render payloads written before a schema change.
 *
 * Case-insensitivity is not defensive padding, it is required. A single real
 * capture disagrees with itself: `properties.denySettings.mode` is `"none"` while
 * `properties.changes.denySettingsChange.before.mode` is `"None"`, in the same file.
 */

/** Outcome of parsing one enum-valued field. */
export interface Parsed<T extends string> {
  /** Canonical value when recognised; the raw string verbatim when not. */
  value: T | string;
  /** False when the value is not in the known set — render it, but flag it. */
  known: boolean;
}

/**
 * Resource-level change types, per the `deploymentStacks` swagger.
 * `detach` and `delete` are what deployment what-if cannot tell you and stack
 * what-if can; they are the entire reason this project uses the stack variant.
 */
export const RESOURCE_CHANGE_TYPES = [
  'create',
  'delete',
  'detach',
  'modify',
  'noChange',
  'unsupported',
] as const;
export type ResourceChangeType = (typeof RESOURCE_CHANGE_TYPES)[number];

/**
 * Property-level change types. A strictly different set from the resource-level
 * one — `array` and `noEffect` appear only here, and `detach` / `noChange` never
 * do. Both `array` and `noEffect` are present in the build 7700017 captures.
 * `noEffect` means the provider will ignore the property you set.
 */
export const PROPERTY_CHANGE_TYPES = ['create', 'delete', 'modify', 'array', 'noEffect'] as const;
export type PropertyChangeType = (typeof PROPERTY_CHANGE_TYPES)[number];

/**
 * Whether the stack still governs the resource after the operation.
 *
 * Azure sends `notManaged`, in every capture here, although the 2025-07-01 spec
 * names it `unmanaged`; both are known, and both mean the stack lets go.
 * `unknown` is what a short-circuited resource carries: Azure could not say.
 */
export const MANAGEMENT_STATUSES = ['managed', 'notManaged', 'unmanaged', 'unknown'] as const;
export type ManagementStatus = (typeof MANAGEMENT_STATUSES)[number];

/** Deny-assignment state on the resource. */
export const DENY_STATUSES = [
  'none',
  'denyDelete',
  'denyWriteAndDelete',
  'notSupported',
  'removedBySystem',
  'inapplicable',
  'unknown',
] as const;
export type DenyStatus = (typeof DENY_STATUSES)[number];

function makeParser<T extends string>(known: readonly T[]): (input: unknown) => Parsed<T> | undefined {
  const byLower = new Map(known.map((k) => [k.toLowerCase(), k]));
  return (input: unknown) => {
    if (typeof input !== 'string' || input.length === 0) return undefined;
    const hit = byLower.get(input.toLowerCase());
    return hit ? { value: hit, known: true } : { value: input, known: false };
  };
}

export const parseResourceChangeType = makeParser(RESOURCE_CHANGE_TYPES);
export const parsePropertyChangeType = makeParser(PROPERTY_CHANGE_TYPES);
export const parseManagementStatus = makeParser(MANAGEMENT_STATUSES);
export const parseDenyStatus = makeParser(DENY_STATUSES);

/**
 * How much protection a deny status confers. Comparing two of these is how
 * "the deny mode weakened" gets decided.
 *
 * `notSupported` and `removedBySystem` both score 0 because neither protects
 * anything — but they are not the same as `none`. Going from `denyWriteAndDelete`
 * to `removedBySystem` is a real loss of protection and must rank as one, which
 * falls out of the comparison automatically.
 *
 * An unrecognised status returns `undefined`, and an undefined on either side
 * means "cannot tell" — which is deliberately *not* the same as "did not weaken".
 */
export function denyStrength(status: string | undefined): number | undefined {
  switch (status) {
    case 'denyWriteAndDelete':
      return 2;
    case 'denyDelete':
      return 1;
    case 'none':
    case 'notSupported':
    case 'removedBySystem':
    case 'inapplicable':
      return 0;
    default:
      return undefined;
  }
}
