import { diagnosticsFor } from '@bicep-whatif/core';
import type { GridRow, StackView } from '../model/estate.js';
import { Glyph } from './Glyph.js';
import { hasPropertyLines } from '../model/propertyLines.js';
import { PropertyChanges } from './PropertyChanges.js';
import { DiagnosticList, Fact, StackDetail } from './StackDetail.js';

export interface RowDetailProps {
  row: GridRow;
  stack: StackView | undefined;
  hideNoise: boolean;
  /**
   * Also say what is true of the row's stack. On in the flat list, where there
   * is no stack line to open; off under a stack line, which already says it.
   */
  withStack: boolean;
}

function statusText(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return '—';
  return `${before ?? '—'} → ${after ?? '—'}`;
}

/**
 * A row, opened where it was clicked.
 *
 * Property changes come first: they are usually why someone opened the row.
 * Above them, only the reasons it ranks where it does; below them, the facts on
 * one wrapping line. The side panel this replaces stacked seven sections into a
 * 420px column as tall as whatever the banners left over.
 */
export function RowDetail(props: RowDetailProps): React.ReactElement {
  const { row, stack } = props;
  const resource = row.resource;
  const ownDiagnostics = row.isStagePlaceholder ? [] : diagnosticsFor(stack?.stack?.diagnostics ?? [], row);

  return (
    <div className="rowdetail" role="region" aria-label={`Details for ${row.name}`}>
      {/*
        `severityReasons` comes back most-severe first, and it is rendered in
        that order. A grid that ranks a noChange row above two hundred modify
        rows and cannot say why will not be trusted — and that row is the whole
        point of the tool.
      */}
      <ul className="reasons" aria-label="Why it ranks here">
        {row.reasons.map((reason, i) => (
          <li className="reason" key={`${reason.code}:${String(i)}`}>
            <Glyph
              severity={reason.severity}
              size={16}
              label={row.isStagePlaceholder ? 'not evaluated' : undefined}
            />
            <span className="reason__detail">{reason.detail}</span>
          </li>
        ))}
      </ul>

      {!row.isStagePlaceholder && (
        <>
          {resource === undefined || resource.propertyChanges.length === 0 ? (
            <p className="muted">No property-level changes reported.</p>
          ) : hasPropertyLines(resource.propertyChanges, props.hideNoise) ? (
            <PropertyChanges changes={resource.propertyChanges} hideNoise={props.hideNoise} />
          ) : (
            <p className="muted">
              Every property change here is noise. Clear &ldquo;Hide unchanged properties&rdquo; to see them.
            </p>
          )}

          <dl className="facts">
            <Fact label="Change">
              {row.changeType}
              {!row.changeTypeKnown && <span className="muted"> (not recognised)</span>}
            </Fact>
            {resource?.changeCertainty !== undefined && resource.changeCertainty !== 'definite' && (
              <Fact label="Certainty">
                {resource.changeCertainty}
                {resource.changeCertainty === 'potential' && (
                  <span className="muted"> — may or may not happen, depending on the deploy</span>
                )}
              </Fact>
            )}
            {resource?.unsupportedReason !== undefined && (
              <Fact label="Not predicted">{resource.unsupportedReason}</Fact>
            )}
            <Fact label="Management">
              {statusText(resource?.managementStatus.before?.value, resource?.managementStatus.after?.value)}
            </Fact>
            <Fact label="Deny">
              {statusText(resource?.denyStatus.before?.value, resource?.denyStatus.after?.value)}
            </Fact>
            {resource?.resourceGroup !== undefined && <Fact label="Resource group">{resource.resourceGroup}</Fact>}
            <Fact label="Type">{row.resourceType}</Fact>
            <Fact label="Resource id">{row.resourceId.length > 0 ? row.resourceId : '—'}</Fact>
          </dl>
        </>
      )}

      {ownDiagnostics.length > 0 && (
        <section className="section">
          <h3 className="section__head">Azure diagnostics about this resource</h3>
          <DiagnosticList diagnostics={ownDiagnostics} />
        </section>
      )}

      {(props.withStack || row.isStagePlaceholder) && stack && (
        <section className="section">
          <h3 className="section__head">Stack {stack.label}</h3>
          <StackDetail stack={stack} />
        </section>
      )}
    </div>
  );
}
