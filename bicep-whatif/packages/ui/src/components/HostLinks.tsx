import { createContext, useContext } from 'react';

/**
 * Links out of the tab into Azure DevOps: the build's results page, and how to
 * open a page of it. Provided once by `App`, read where a link is drawn, so the
 * components between them don't carry it.
 */
export interface HostLinks {
  /** `…/_build/results?buildId=N`. Undefined in mock mode, or when the host didn't say. */
  buildResultsUrl?: string | undefined;
  openUrl: (url: string) => void;
}

export const HostLinksContext = createContext<HostLinks>({
  openUrl: (url) => {
    window.open(url, '_blank', 'noopener');
  },
});

export function useHostLinks(): HostLinks {
  return useContext(HostLinksContext);
}
