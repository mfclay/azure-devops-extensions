/**
 * Which Bicep binary to fetch, and from where. Pure — the interesting part is
 * the platform matrix, and that is worth testing without a network.
 *
 * Decision **D5**: download a version-pinned binary at run time rather than
 * bundling one. The linux-x64 asset is ~105 MB against a 50 MB VSIX limit, so
 * bundling is not a trade-off, it is impossible.
 *
 * And **do not prefer a `bicep` already on PATH**. Pinning is the feature:
 * compiler output changes across versions, and two teams running the same
 * template through the same task should get the same what-if. An agent-image
 * upgrade silently changing a preview is exactly the failure this avoids.
 */

/**
 * The default pin.
 *
 * Bumping this is a deliberate act with a changelog behind it, not a chore.
 * Verified against the GitHub releases API on 2026-08-25: v0.46.1, published
 * 2026-07-30, is the newest release, and every asset name below is one it
 * actually publishes.
 */
export const DEFAULT_BICEP_VERSION = '0.46.1';

export class BicepAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BicepAssetError';
  }
}

/** `v0.46.1`, `0.46.1` and ` 0.46.1 ` all mean the same release. */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new BicepAssetError(
      `bicepVersion "${version}" is not a three-part version such as 0.46.1.`,
    );
  }
  return trimmed;
}

export interface PlatformInfo {
  platform: NodeJS.Platform | string;
  arch: string;
  /** Alpine and other musl distributions need their own build. */
  musl: boolean;
}

/**
 * Asset names read off the Azure/bicep releases API rather than recalled — the
 * Windows arm64 asset is `bicep-win-arm64.exe` while the installer beside it is
 * `bicep-setup-win-x64.exe`, and picking the installer would download 50 MB of
 * something that is not a compiler.
 */
export function bicepAssetName(info: PlatformInfo): string {
  const { platform, arch, musl } = info;
  if (platform === 'linux') {
    if (arch === 'x64') return musl ? 'bicep-linux-musl-x64' : 'bicep-linux-x64';
    if (arch === 'arm64') return 'bicep-linux-arm64';
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'bicep-osx-x64';
    if (arch === 'arm64') return 'bicep-osx-arm64';
  }
  if (platform === 'win32') {
    if (arch === 'x64') return 'bicep-win-x64.exe';
    if (arch === 'arm64') return 'bicep-win-arm64.exe';
  }
  throw new BicepAssetError(
    `No Bicep binary is published for ${platform}/${arch}. Azure/bicep ships linux, osx and ` +
      'win32 on x64 and arm64, plus a musl build for linux x64.',
  );
}

export function bicepDownloadUrl(version: string, assetName: string): string {
  return `https://github.com/Azure/bicep/releases/download/v${normalizeVersion(version)}/${assetName}`;
}

/** The name the binary is cached and executed under. */
export function bicepFileName(platform: NodeJS.Platform | string): string {
  return platform === 'win32' ? 'bicep.exe' : 'bicep';
}
