/** How long before `now`: "45m ago", "5h ago", "17d ago", "3mo ago". */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const minutes = Math.max(0, (now - Date.parse(iso)) / 6e4);
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / 1440);
  return days < 60 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

/** "42s", "12m", "1.5h"; a dash for none. */
export function duration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 6e4) return `${Math.round(ms / 1e3)}s`;
  if (ms < 36e5) return `${Math.round(ms / 6e4)}m`;
  return `${(ms / 36e5).toFixed(1)}h`;
}

/** `\services\production` as "services \ production"; the root as "(root)". */
export function folderTitle(folder: string): string {
  return folder.replace(/^\\/, '').split('\\').join(' \\ ') || '(root)';
}

/** "22:47:10 UTC". */
export function clock(now: number): string {
  return `${new Date(now).toISOString().slice(11, 19)} UTC`;
}

/** "Sat, 03 Oct 2026 22:47 UTC". */
export function asOf(now: number): string {
  return new Date(now).toUTCString().replace(/:\d\d GMT/, ' UTC');
}

export const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/** "2 archived and 1 disabled pipeline": the retired pipelines the counts leave out. */
export function notCounted(archived: number, disabled: number): string {
  const parts = [archived && `${archived} archived`, disabled && `${disabled} disabled`].filter(Boolean);
  return `${parts.join(' and ')} ${archived + disabled === 1 ? 'pipeline' : 'pipelines'}`;
}
