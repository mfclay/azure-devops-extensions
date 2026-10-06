/**
 * What the source coped with while reading the build as a whole: an attachment
 * it could not read or link, a build with no what-if stages at all, mock mode.
 *
 * `LoadResult.notes` promises these are "shown, never swallowed". Per-stack
 * notes have the detail panel; these belong to no row, so without this they
 * reach nowhere, and a build with no what-if stages would render as an empty
 * page with no explanation. Like the not-evaluated banner, it does not dismiss.
 */
export function BuildNotes({ notes }: { notes: readonly string[] }): React.ReactElement | null {
  if (notes.length === 0) return null;

  return (
    <div className="banner banner--info" role="note" aria-label="Notes about this build">
      <span className="banner__glyph" aria-hidden="true">
        i
      </span>
      <ul className="banner__notes">
        {notes.map((n, i) => (
          <li key={String(i)}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
