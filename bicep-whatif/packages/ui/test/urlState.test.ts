import { describe, expect, it } from 'vitest';
import { decodeViewState, encodeViewState } from '../src/model/urlState.js';
import { DEFAULT_SEVERITIES, defaultViewState } from '../src/model/view.js';

describe('encodeViewState', () => {
  it('encodes the default view as an empty hash', () => {
    expect(encodeViewState(defaultViewState())).toBe('');
  });

  it('carries only what the sender actually changed', () => {
    const state = { ...defaultViewState(), selected: '/subscriptions/x/kv-platform-prod' };
    expect(encodeViewState(state)).toBe('sel=%2Fsubscriptions%2Fx%2Fkv-platform-prod');
  });

  it('is order-independent, so the same view always produces the same link', () => {
    const a = { ...defaultViewState(), stacks: new Set(['b', 'a']) };
    const b = { ...defaultViewState(), stacks: new Set(['a', 'b']) };
    expect(encodeViewState(a)).toBe(encodeViewState(b));
  });
});

describe('round trip', () => {
  it('survives every field at once', () => {
    const state = {
      severities: new Set<'destructive' | 'modify'>(['destructive', 'modify']),
      stacks: new Set(['network', 'client-01']),
      query: 'key vault',
      hideNoise: true,
      selected: '/subscriptions/x/kv',
    };
    const back = decodeViewState(encodeViewState(state));
    expect([...back.severities].sort()).toEqual(['destructive', 'modify']);
    expect([...(back.stacks ?? [])].sort()).toEqual(['client-01', 'network']);
    expect(back.query).toBe('key vault');
    expect(back.hideNoise).toBe(true);
    expect(back.selected).toBe('/subscriptions/x/kv');
  });

  it('round-trips a resource id containing separators', () => {
    const id = '/subscriptions/a&b/resourceGroups/rg=1/providers/x,y';
    const back = decodeViewState(encodeViewState({ ...defaultViewState(), selected: id }));
    expect(back.selected).toBe(id);
  });
});

describe('decodeViewState is tolerant, but never quietly hides anything', () => {
  it('falls back to the default when every severity token is unrecognised', () => {
    const back = decodeViewState('sev=nonsense,alsoNonsense');
    expect(back.severities).toEqual(new Set(DEFAULT_SEVERITIES));
  });

  it('falls back to the default rather than showing an empty grid', () => {
    // An empty `sev` would otherwise render as "no changes", which is the exact
    // lie this project exists to prevent.
    expect(decodeViewState('sev=').severities).toEqual(new Set(DEFAULT_SEVERITIES));
  });

  it('keeps the severities it does recognise and drops the rest', () => {
    expect([...decodeViewState('sev=destructive,bogus').severities]).toEqual(['destructive']);
  });

  it('ignores keys it does not know', () => {
    expect(decodeViewState('somethingElse=1')).toEqual(defaultViewState());
  });

  it('accepts a leading hash', () => {
    expect(decodeViewState('#q=abc').query).toBe('abc');
  });

  it('treats an empty stack list as "all stacks"', () => {
    expect(decodeViewState('stacks=').stacks).toBeNull();
  });
});
