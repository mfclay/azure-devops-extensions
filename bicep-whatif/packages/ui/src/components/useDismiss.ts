import { useEffect, type RefObject } from 'react';

/**
 * Close a popup menu on Escape, or on a press anywhere outside `root`. Shared
 * by the toolbar's menus so they close the same way.
 */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, root]);
}
