/**
 * Which extension, at which version, is drawing this tab, behind the footer's
 * "About this extension" link, so a bug report can say what it was taken from
 * without the tab printing it on every page.
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

/** The same addresses as the manifest's `links`. */
export const DOCS_URL = 'https://github.com/mfclay/azure-devops-extensions/tree/main/bicep-whatif';
export const ISSUE_URL = 'https://github.com/mfclay/azure-devops-extensions/issues/new?template=bicep-whatif.yml';

export interface About {
  /** `MichaelC.bicep-whatif-dev 1.0.8`: what to quote in a bug report. */
  line: string;
  /** The extension's Marketplace page, when the host named the extension. */
  listingUrl?: string | undefined;
}

export function aboutOf(context: ExtensionContextLike | undefined): About {
  const id = typeof context?.id === 'string' && context.id.length > 0 ? context.id : undefined;
  return {
    line: aboutLine(context),
    listingUrl:
      id === undefined ? undefined : `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(id)}`,
  };
}

/** `?mock=1`: committed fixtures, no host, so no installed version to report. */
export const MOCK_ABOUT: About = { line: 'mock mode, no installed extension' };
