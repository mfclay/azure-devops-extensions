import { describe, expect, it } from 'vitest';
import { failureEnvelope, outcomeOf, validationOutcomeOf } from '../src/outcome.js';

describe('outcomeOf', () => {
  it('reports succeeded only on a terminal succeeded state with no error', () => {
    const outcome = outcomeOf({
      id: '/subscriptions/s/providers/Microsoft.Resources/deploymentStacksWhatIfResults/w',
      properties: { provisioningState: 'succeeded', changes: { resourceChanges: [] } },
    });
    expect(outcome.status).toBe('succeeded');
    expect(outcome.error).toBeNull();
    expect(outcome.resourceId).toContain('deploymentStacksWhatIfResults/w');
  });

  it('accepts the casing the PowerShell compared against', () => {
    // PowerShell's -eq is case-insensitive, so `Succeeded` passed there. Payloads
    // from both sides of the migration have to read the same.
    expect(outcomeOf({ properties: { provisioningState: 'Succeeded' } }).status).toBe('succeeded');
  });

  it('fails when properties carry an error even if the state says succeeded', () => {
    const outcome = outcomeOf({
      properties: { provisioningState: 'succeeded', error: { code: 'X', message: 'y' } },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toEqual({ code: 'X', message: 'y' });
  });

  it('reads a top-level error when there are no properties at all', () => {
    // The failure envelope this task synthesizes has that shape.
    const outcome = outcomeOf({ status: 'Failed', error: { code: 'CliError', message: 'boom' } });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toEqual({ code: 'CliError', message: 'boom' });
  });

  it('treats a non-terminal state as failed, because polling has already stopped', () => {
    expect(outcomeOf({ properties: { provisioningState: 'deploying' } }).status).toBe('failed');
  });

  it('treats an absent provisioningState as failed rather than assuming the best', () => {
    expect(outcomeOf({ properties: {} }).status).toBe('failed');
    expect(outcomeOf(null).status).toBe('failed');
    expect(outcomeOf(undefined).status).toBe('failed');
  });

  it('never throws, whatever it is handed', () => {
    for (const value of ['a string', 42, [], true]) {
      expect(() => outcomeOf(value)).not.toThrow();
      expect(outcomeOf(value).status).toBe('failed');
    }
  });
});

describe('failureEnvelope', () => {
  it('is shaped like a payload so downstream code needs no special case', () => {
    const envelope = failureEnvelope('AuthError', 'no token');
    expect(outcomeOf(envelope).status).toBe('failed');
    expect(outcomeOf(envelope).error).toMatchObject({ code: 'AuthError', message: 'no token' });
  });
});

describe('validationOutcomeOf', () => {
  it('succeeds on a result with no error, though it has no provisioningState', () => {
    const outcome = validationOutcomeOf({ id: 'stack', properties: { validatedResources: [] } });
    expect(outcome.status).toBe('succeeded');
    expect(outcome.resourceId).toBe('stack');
  });

  it('fails on an error at the top or in properties, and on no result at all', () => {
    expect(validationOutcomeOf({ error: { code: 'X' } }).status).toBe('failed');
    expect(validationOutcomeOf({ properties: { error: { code: 'X' } } }).status).toBe('failed');
    expect(validationOutcomeOf(undefined).status).toBe('failed');
  });
});
