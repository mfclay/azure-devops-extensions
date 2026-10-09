import { describe, expect, it } from 'vitest';
import { aboutLine } from '../src/data/about.js';

describe('aboutLine', () => {
  it('names the extension by its full id, then the version', () => {
    expect(aboutLine({ id: 'MichaelC.bicep-whatif-dev', version: '1.0.8' })).toBe('MichaelC.bicep-whatif-dev 1.0.8');
  });

  it('says what it does not know rather than leaving a gap', () => {
    expect(aboutLine({ id: 'MichaelC.bicep-whatif' })).toBe('MichaelC.bicep-whatif unknown version');
    expect(aboutLine({ version: 7 })).toBe('version unknown: the host did not say');
    expect(aboutLine(undefined)).toBe('version unknown: the host did not say');
  });
});
