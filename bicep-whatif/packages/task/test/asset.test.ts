import { describe, expect, it } from 'vitest';
import {
  BicepAssetError,
  DEFAULT_BICEP_VERSION,
  bicepAssetName,
  bicepDownloadUrl,
  bicepFileName,
  normalizeVersion,
} from '../src/bicep/asset.js';

describe('normalizeVersion', () => {
  it('accepts a bare or v-prefixed version', () => {
    expect(normalizeVersion('0.46.1')).toBe('0.46.1');
    expect(normalizeVersion('v0.46.1')).toBe('0.46.1');
    expect(normalizeVersion('  V0.46.1 ')).toBe('0.46.1');
  });

  it('rejects anything that is not three parts', () => {
    expect(() => normalizeVersion('latest')).toThrow(BicepAssetError);
    expect(() => normalizeVersion('0.46')).toThrow(BicepAssetError);
  });
});

describe('bicepAssetName', () => {
  it('picks the right asset for every platform Azure/bicep publishes', () => {
    const cases: [string, string, boolean, string][] = [
      ['linux', 'x64', false, 'bicep-linux-x64'],
      ['linux', 'x64', true, 'bicep-linux-musl-x64'],
      ['linux', 'arm64', false, 'bicep-linux-arm64'],
      ['darwin', 'x64', false, 'bicep-osx-x64'],
      ['darwin', 'arm64', false, 'bicep-osx-arm64'],
      ['win32', 'x64', false, 'bicep-win-x64.exe'],
      ['win32', 'arm64', false, 'bicep-win-arm64.exe'],
    ];
    for (const [platform, arch, musl, expected] of cases) {
      expect(bicepAssetName({ platform, arch, musl })).toBe(expected);
    }
  });

  it('never picks the Windows installer', () => {
    // `bicep-setup-win-x64.exe` sits beside `bicep-win-x64.exe` in the same
    // release and is 50 MB of something that is not a compiler.
    expect(bicepAssetName({ platform: 'win32', arch: 'x64', musl: false })).not.toContain('setup');
  });

  it('names the platform when there is no binary for it', () => {
    expect(() => bicepAssetName({ platform: 'aix', arch: 'ppc64', musl: false })).toThrow(
      /aix\/ppc64/,
    );
  });
});

describe('bicepDownloadUrl', () => {
  it('points at the pinned release tag', () => {
    expect(bicepDownloadUrl('0.46.1', 'bicep-linux-x64')).toBe(
      'https://github.com/Azure/bicep/releases/download/v0.46.1/bicep-linux-x64',
    );
  });

  it('is pinned, not floating', () => {
    // Compiler output changes across versions; two teams running the same
    // template through this task should get the same what-if.
    expect(bicepDownloadUrl(DEFAULT_BICEP_VERSION, 'bicep-linux-x64')).not.toContain('latest');
  });
});

describe('bicepFileName', () => {
  it('adds .exe only on Windows', () => {
    expect(bicepFileName('win32')).toBe('bicep.exe');
    expect(bicepFileName('linux')).toBe('bicep');
  });
});
