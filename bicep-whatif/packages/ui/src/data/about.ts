/**
 * Which extension, at which version, is drawing this tab: the line in the
 * footer, so a screenshot or a bug report says what it was taken from.
 *
 * The host knows the installed version (`SDK.getExtensionContext()`), so
 * nothing is stamped into the bundle at build time. A dev and a release install
 * differ by extension id, which is why the line carries the full id.
 */
export interface ExtensionContextLike {
  id?: unknown;
  version?: unknown;
}

export function aboutLine(context: ExtensionContextLike | undefined): string {
  const id = typeof context?.id === 'string' && context.id.length > 0 ? context.id : undefined;
  const version = typeof context?.version === 'string' && context.version.length > 0 ? context.version : undefined;
  if (id === undefined && version === undefined) return 'version unknown: the host did not say';
  return [id ?? 'unknown extension', version ?? 'unknown version'].join(' ');
}

/** `?mock=1`: committed fixtures, no host, so no installed version to report. */
export const MOCK_ABOUT = 'mock mode, no installed extension';
