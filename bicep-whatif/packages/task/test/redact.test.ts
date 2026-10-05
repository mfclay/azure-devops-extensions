import { describe, expect, it } from 'vitest';
import { REDACTION_PLACEHOLDER } from '../src/contract.js';
import {
  RedactionError,
  redactPayload,
  redactText,
  secureValuesFrom,
  stringLeaves,
} from '../src/redact.js';

const TEMPLATE = {
  parameters: {
    location: { type: 'string' },
    postgresAdminPassword: { type: 'securestring' },
    settings: { type: 'secureObject' },
  },
};

const PARAMETERS = {
  parameters: {
    location: { value: 'centralus' },
    postgresAdminPassword: { value: 'hunter2-correct-horse' },
    settings: { value: { nested: { token: 'deep-secret-value' }, list: ['another-secret'] } },
  },
};

describe('stringLeaves', () => {
  it('pulls strings out of any shape', () => {
    expect(stringLeaves({ a: 'x', b: [{ c: 'y' }], d: 3, e: null })).toEqual(['x', 'y']);
  });
});

describe('secureValuesFrom', () => {
  it('collects securestring and secureObject values, and nothing else', () => {
    const values = secureValuesFrom(TEMPLATE, PARAMETERS);
    expect(values).toContain('hunter2-correct-horse');
    expect(values).toContain('deep-secret-value');
    expect(values).toContain('another-secret');
    expect(values).not.toContain('centralus');
  });

  it('matches the ARM spellings case-insensitively', () => {
    const values = secureValuesFrom(
      { parameters: { p: { type: 'SecureString' } } },
      { parameters: { p: { value: 'a-secret-value' } } },
    );
    expect(values).toEqual(['a-secret-value']);
  });

  it('ignores values too short to be a secret', () => {
    // Replacing "ab" throughout a payload would shred unrelated content.
    const values = secureValuesFrom(
      { parameters: { p: { type: 'securestring' } } },
      { parameters: { p: { value: 'ab' } } },
    );
    expect(values).toEqual([]);
  });

  it('fails closed when it cannot tell which parameters are secure', () => {
    // Not knowing is not a reason to publish the payload anyway.
    expect(() => secureValuesFrom({ noParametersBlock: true }, PARAMETERS)).toThrow(RedactionError);
    expect(() => secureValuesFrom(null, PARAMETERS)).toThrow(RedactionError);
  });

  it('returns nothing for a template with no secure parameters', () => {
    // network and shared-infra, the two stacks that exist live.
    expect(secureValuesFrom({ parameters: { location: { type: 'string' } } }, {})).toEqual([]);
  });
});

describe('redactText', () => {
  it('replaces a secret wherever it appears, including inside a larger string', () => {
    const text = 'psql://user:hunter2@host and also hunter2 alone';
    expect(redactText(text, ['hunter2'])).toBe(
      `psql://user:${REDACTION_PLACEHOLDER}@host and also ${REDACTION_PLACEHOLDER} alone`,
    );
  });

  it('replaces the JSON-escaped form as well as the raw one', () => {
    // A secret holding a quote appears only in its escaped form inside a
    // serialized payload, so matching the raw form alone would miss it.
    const secret = 'pa"ss\\word';
    const payload = JSON.stringify({ after: { password: secret } });
    expect(payload).not.toContain(secret);
    expect(redactText(payload, [secret])).toContain(REDACTION_PLACEHOLDER);
    expect(redactText(payload, [secret])).not.toContain('pa\\"ss');
  });

  it('replaces the longest secret first so a prefix cannot leak the rest', () => {
    // "abcd" is a prefix of "abcdefghij". Shortest-first would leave "efghij"
    // in the clear beside a placeholder claiming it had been handled.
    const out = redactText('value=abcdefghij', ['abcd', 'abcdefghij']);
    expect(out).toBe(`value=${REDACTION_PLACEHOLDER}`);
    expect(out).not.toContain('efghij');
  });

  it('leaves text alone when there is nothing to redact', () => {
    expect(redactText('nothing here', [])).toBe('nothing here');
    expect(redactText('', ['x'])).toBe('');
  });
});

describe('redactPayload', () => {
  it('scrubs a value that only appears deep inside the payload', () => {
    const payload = {
      properties: {
        changes: {
          resourceChanges: [
            {
              resourceConfigurationChanges: {
                after: { properties: { administratorLoginPassword: 'hunter2-correct-horse' } },
              },
            },
          ],
        },
      },
    };
    const redacted = redactPayload(payload, ['hunter2-correct-horse']);
    expect(JSON.stringify(redacted)).not.toContain('hunter2-correct-horse');
    expect(JSON.stringify(redacted)).toContain(REDACTION_PLACEHOLDER);
  });

  it('preserves structure', () => {
    const payload = { a: [1, 2, { b: null }], c: true };
    expect(redactPayload(payload, [])).toEqual(payload);
  });
});
