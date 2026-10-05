/**
 * The severity ladder, and the reason it is a function rather than a sort.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeStackWhatIf,
  severityOf,
  compareBySeverityDesc,
  parseResourceChangeType,
  parseDenyStatus,
  parseManagementStatus,
  denyStrength,
  RESOURCE_CHANGE_TYPES,
  SEVERITY_RANK,
  SEVERITIES,
  type Severity,
} from '../src/index.js';
import { SYNTH_SEVERITY } from './fixtures.js';

const ct = (v: string) => parseResourceChangeType(v);

describe('the ladder', () => {
  it('orders destructive > protectionLoss > create > modify > unevaluated > noChange', () => {
    const order: Severity[] = [
      'destructive',
      'protectionLoss',
      'create',
      'modify',
      'unevaluated',
      'noChange',
    ];
    const ranks = order.map((s) => SEVERITY_RANK[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(SEVERITIES)).toEqual(new Set(order));
  });

  it('maps every change type in the enum to a severity', () => {
    for (const c of RESOURCE_CHANGE_TYPES) {
      const v = severityOf({ changeType: ct(c) });
      expect(SEVERITIES).toContain(v.severity);
      expect(v.reasons.length).toBeGreaterThan(0);
    }
  });

  it('ranks unevaluated above noChange, so a default filter cannot hide it', () => {
    // This is the correctness rule in miniature. A UI hides noChange by default;
    // a resource nobody could evaluate must not be swept up by that rule.
    expect(SEVERITY_RANK.unevaluated).toBeGreaterThan(SEVERITY_RANK.noChange);
    expect(severityOf({ changeType: ct('unsupported') }).severity).toBe('unevaluated');
  });
});

describe('the axes collapse — change type alone is not enough', () => {
  it('a noChange resource going notManaged is protection loss, not noChange', () => {
    // The single case that justifies this whole function existing.
    const v = severityOf({
      changeType: ct('noChange'),
      managementStatus: { before: parseManagementStatus('managed'), after: parseManagementStatus('notManaged') },
    });
    expect(v.severity).toBe('protectionLoss');
    expect(v.reasons.map((r) => r.code)).toContain('managementLost');
  });

  it('a modify whose deny mode weakens outranks an ordinary modify', () => {
    const plain = severityOf({ changeType: ct('modify') });
    const weakened = severityOf({
      changeType: ct('modify'),
      denyStatus: { before: parseDenyStatus('denyWriteAndDelete'), after: parseDenyStatus('denyDelete') },
    });
    expect(plain.severity).toBe('modify');
    expect(weakened.severity).toBe('protectionLoss');
    expect(weakened.rank).toBeGreaterThan(plain.rank);
  });

  it('deny protection strengthening is not a loss', () => {
    const v = severityOf({
      changeType: ct('modify'),
      denyStatus: { before: parseDenyStatus('none'), after: parseDenyStatus('denyWriteAndDelete') },
    });
    expect(v.severity).toBe('modify');
  });

  it('removedBySystem counts as weakening from a real deny mode', () => {
    expect(denyStrength('removedBySystem')).toBe(0);
    const v = severityOf({
      changeType: ct('noChange'),
      denyStatus: { before: parseDenyStatus('denyWriteAndDelete'), after: parseDenyStatus('removedBySystem') },
    });
    expect(v.severity).toBe('protectionLoss');
  });

  it('takes the maximum across axes — delete stays destructive even with protection loss', () => {
    const v = severityOf({
      changeType: ct('delete'),
      managementStatus: { before: parseManagementStatus('managed'), after: parseManagementStatus('notManaged') },
      denyStatus: { before: parseDenyStatus('denyWriteAndDelete'), after: parseDenyStatus('none') },
    });
    expect(v.severity).toBe('destructive');
    // Every axis that fired is still reported, not just the winning one.
    expect(v.reasons.map((r) => r.code).sort()).toEqual(
      ['denyWeakened', 'managementLost', 'resourceDeleted'].sort(),
    );
    // Most severe reason first, so a UI showing one shows the deciding one.
    expect(v.reasons[0]?.code).toBe('resourceDeleted');
  });

  it('does not guess when a deny status is unrecognised', () => {
    // "Cannot tell" is not "did not weaken", but it is also not a false alarm.
    const v = severityOf({
      changeType: ct('modify'),
      denyStatus: { before: parseDenyStatus('denyWriteAndDelete'), after: parseDenyStatus('somethingNew') },
    });
    expect(v.severity).toBe('modify');
    expect(v.reasons.map((r) => r.code)).not.toContain('denyWeakened');
  });
});

describe('synthetic Detach and Delete — no live stack produces these', () => {
  const r = () => normalizeStackWhatIf(SYNTH_SEVERITY());

  it('ranks Delete and Detach above Create', () => {
    const rows = r().rows;
    const by = (n: string) => rows.find((x) => x.symbolicName === n)!;
    expect(by('doomedStorage').severity).toBe('destructive');
    expect(by('detachedVnet').severity).toBe('protectionLoss');
    expect(by('newInsights').severity).toBe('create');
    expect(by('doomedStorage').severityRank).toBeGreaterThan(by('newInsights').severityRank);
    expect(by('detachedVnet').severityRank).toBeGreaterThan(by('newInsights').severityRank);
  });

  it('catches the quiet one: noChange + notManaged ranks above every Modify', () => {
    const rows = r().rows;
    const quiet = rows.find((x) => x.symbolicName === 'quietlyUnmanagedVault')!;
    expect(quiet.changeType).toBe('noChange');
    expect(quiet.severity).toBe('protectionLoss');
    expect(quiet.managementLost).toBe(true);
    // Sorted by severity it surfaces; sorted by changeType it would be bottom of the list.
    const sorted = [...rows].sort(compareBySeverityDesc);
    expect(sorted.slice(0, 3).map((x) => x.symbolicName)).toContain('quietlyUnmanagedVault');
  });

  it('flags the weakened registry through the deny axis alone', () => {
    const acr = r().rows.find((x) => x.symbolicName === 'weakenedRegistry')!;
    expect(acr.changeType).toBe('modify');
    expect(acr.denyWeakened).toBe(true);
    expect(acr.severity).toBe('protectionLoss');
  });

  it('ranks an unsupported resource as unevaluated and keeps the reason', () => {
    const w = r().rows.find((x) => x.symbolicName === 'opaqueWidget')!;
    expect(w.severity).toBe('unevaluated');
    expect(w.unsupportedReason).toBe('ResourceTypeUnsupported');
  });

  it('notices the stack-scoped deny settings weakening', () => {
    expect(r().denySettingsWeakened).toBe(true);
  });

  it('sorts most dangerous first', () => {
    const sorted = [...r().rows].sort(compareBySeverityDesc);
    expect(sorted[0]?.symbolicName).toBe('doomedStorage');
    expect(sorted.at(-1)?.symbolicName).toBe('opaqueWidget');
  });
});
