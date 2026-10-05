/**
 * Decision **F3**: redact by value, not by path.
 *
 * A `@secure()` parameter's value reaches the what-if payload. In the estate
 * this was written for, `04-client-stack.bicep` declares
 * `@secure() param postgresAdminPassword`, which lands on
 * `administratorLoginPassword` in `postgresql-server.bicep`. ARM never returns
 * that property from a GET — it is write-only, so `before` is safe — but `after`
 * is computed from the template just handed over, so a Create puts the literal
 * password there.
 *
 * A path denylist has to predict where a secret is echoed back, and is wrong the
 * first time a template wires the same parameter somewhere new: a connection
 * string, a container env var, an app setting. Replacing the *value* catches
 * every such site, including occurrences inside a larger string.
 *
 * Ported from `Get-SecureParameterValue` / `Remove-SecureValueFromText` in
 * `Invoke-StackWhatIf.ps1`.
 */
import { REDACTION_PLACEHOLDER } from './contract.js';

/**
 * Below this length a value is not a secret, and replacing it throughout a
 * payload would shred unrelated content — a two-character password would blank
 * out every `id` and `sku` that happened to contain it.
 */
const MIN_SECRET_LENGTH = 4;

/** ARM writes these two spellings; matched case-insensitively. */
const SECURE_TYPES = /^secure(string|object)$/i;

/**
 * Every string buried anywhere in a value.
 *
 * `secureObject` parameters hold their secrets in leaves rather than at the top,
 * so the shape of the value is not something this can assume.
 */
export function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(stringLeaves);
  }
  return [];
}

export class RedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedactionError';
  }
}

/**
 * The values to scrub, read off the compiled template and its parameters.
 *
 * One compile yields both halves: the template carries the declared parameter
 * *types*, the parameters file the resolved *values*, and taking them from a
 * single `bicep build-params` invocation means the two cannot disagree about
 * which parameter is which.
 *
 * Fails closed. Not knowing which parameters are secure is not a reason to
 * publish the payload anyway — so a template with no `parameters` block at all
 * throws rather than returning "no secrets here".
 */
export function secureValuesFrom(template: unknown, parameters: unknown): string[] {
  if (template === null || typeof template !== 'object') {
    throw new RedactionError(
      'The compiled template is not an object, so its secure parameters cannot be identified ' +
        'and the what-if payload cannot be safely published.',
    );
  }
  const declared = (template as Record<string, unknown>)['parameters'];
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new RedactionError(
      'The compiled template has no parameters block, so its secure parameters cannot be ' +
        'identified and the what-if payload cannot be safely published.',
    );
  }

  const supplied =
    parameters !== null && typeof parameters === 'object'
      ? ((parameters as Record<string, unknown>)['parameters'] ?? parameters)
      : {};
  const suppliedMap =
    supplied !== null && typeof supplied === 'object'
      ? (supplied as Record<string, unknown>)
      : {};

  const values = new Set<string>();
  for (const [name, spec] of Object.entries(declared as Record<string, unknown>)) {
    if (spec === null || typeof spec !== 'object') continue;
    const type = (spec as Record<string, unknown>)['type'];
    if (typeof type !== 'string' || !SECURE_TYPES.test(type)) continue;

    const entry = suppliedMap[name];
    const value =
      entry !== null && typeof entry === 'object' && 'value' in (entry as object)
        ? (entry as Record<string, unknown>)['value']
        : undefined;

    for (const leaf of stringLeaves(value)) {
      if (leaf.length >= MIN_SECRET_LENGTH) values.add(leaf);
    }
  }
  return [...values];
}

/**
 * Replace every secure value, and every escaped form of one, throughout a text.
 *
 * Longest first. Where one secret is a prefix of another — a password and the
 * connection string built from it — replacing the short one first would leave
 * the remainder of the long one in the clear next to a placeholder that claims
 * it was handled.
 */
export function redactText(text: string, secureValues: readonly string[]): string {
  if (text.length === 0) return text;
  let out = text;
  for (const secret of [...secureValues].sort((a, b) => b.length - a.length)) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(REDACTION_PLACEHOLDER);

    // Inside JSON the same value is written escaped, and a secret holding a
    // quote or a backslash makes the two forms differ — only the escaped one is
    // present in the serialized payload. JSON.stringify produced that payload,
    // so its escaping is by definition the escaping to match.
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) out = out.split(escaped).join(REDACTION_PLACEHOLDER);
  }
  return out;
}

/**
 * Redact a payload by round-tripping it through its own serialization.
 *
 * Doing it once, on the serialized form, is what makes every downstream sink
 * safe by default: the attachment, the file on disk, the summary rendered from
 * it, and the sidecar's error field all read the redacted object. Redacting per
 * sink instead would leave the next sink someone adds unprotected.
 */
export function redactPayload(payload: unknown, secureValues: readonly string[]): unknown {
  if (payload === undefined) return undefined;
  const json = JSON.stringify(payload);
  if (json === undefined) return payload;
  if (secureValues.length === 0) return JSON.parse(json);
  return JSON.parse(redactText(json, secureValues));
}
