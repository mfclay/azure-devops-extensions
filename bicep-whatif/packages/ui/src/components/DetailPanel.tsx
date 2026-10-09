import { diagnosticsFor, SEVERITY_TONE, type Severity, type WhatIfDiagnostic } from '@bicep-whatif/core';
import type { GridRow, StackView } from '../model/estate.js';
import { Glyph, SEVERITY_LABEL } from './Glyph.js';
import { PropertyDeltaTree } from './PropertyDeltaTree.js';

export interface DetailPanelProps {
  row: GridRow;
  stack: StackView | undefined;
  hideNoise: boolean;
  onClose: () => void;
}

function statusText(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return '—';
  return `${before ?? '—'} → ${after ?? '—'}`;
}

function DiagnosticList({ diagnostics }: { diagnostics: readonly WhatIfDiagnostic[] }): React.ReactElement {
  return (
    <ul className="notes">
      {diagnostics.map((d, i) => (
        <li key={`${d.code ?? ''}:${String(i)}`}>
          <strong>{d.level}</strong>
          {d.code !== undefined && <span className="muted"> {d.code}</span>} — {d.message}
          {d.target !== undefined && <span className="muted"> — {d.target}</span>}
        </li>
      ))}
    </ul>
  );
}

export function DetailPanel(props: DetailPanelProps): React.ReactElement {
  const { row, stack } = props;
  const resource = row.resource;
  const severity: Severity = row.severity;
  // Azure's messages about this what-if: the ones naming this resource first,
  // then the rest of the stack's, which may explain this row just as well.
  const stackDiagnostics = stack?.stack?.diagnostics ?? [];
  const ownDiagnostics = row.isStagePlaceholder ? [] : diagnosticsFor(stackDiagnostics, row);
  const otherDiagnostics = stackDiagnostics.filter((d) => !ownDiagnostics.includes(d));

  return (
    <aside className="detail" aria-label={`Details for ${row.name}`}>
      <div className="detail__head">
        <Glyph severity={severity} />
        <div className="detail__title">
          <h2 className="detail__name">{row.name}</h2>
          <p className="detail__sub">
            {SEVERITY_LABEL[severity]} · {row.stackLabel}
          </p>
        </div>
        <button type="button" className="detail__close" onClick={props.onClose} aria-label="Close details">
          ✕
        </button>
      </div>

      <div className="detail__body">
        {/*
          `severityReasons` comes back most-severe first, and it is rendered in
          that order. A grid that ranks a noChange row above two hundred modify
          rows and cannot say why will not be trusted — and that row is the whole
          point of the tool.
        */}
        <section className="section">
          <h3 className="section__head">Why it ranks here</h3>
          <ul className="reasons">
            {row.reasons.map((reason, i) => (
              <li className="reason" key={`${reason.code}:${String(i)}`}>
                <Glyph severity={reason.severity} />
                <span className="reason__detail">{reason.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {row.isStagePlaceholder ? (
          <section className="section">
            <h3 className="section__head">Stage</h3>
            <dl className="facts">
              <dt>Stage</dt>
              <dd>{stack?.stageId ?? '—'}</dd>
              <dt>Result</dt>
              <dd>{stack?.stageDisplayName ?? row.name}</dd>
            </dl>
          </section>
        ) : (
          <>
            <section className="section">
              <h3 className="section__head">Resource</h3>
              <dl className="facts">
                <dt>Type</dt>
                <dd>{row.resourceType}</dd>
                <dt>Change</dt>
                <dd>
                  {row.changeType}
                  {!row.changeTypeKnown && <span className="muted"> (not recognised)</span>}
                </dd>
                {resource?.changeCertainty !== undefined && resource.changeCertainty !== 'definite' && (
                  <>
                    <dt>Certainty</dt>
                    <dd>
                      {resource.changeCertainty}
                      {resource.changeCertainty === 'potential' && (
                        <span className="muted"> — may or may not happen, depending on the deploy</span>
                      )}
                    </dd>
                  </>
                )}
                {resource?.unsupportedReason !== undefined && (
                  <>
                    <dt>Not predicted</dt>
                    <dd>{resource.unsupportedReason}</dd>
                  </>
                )}
                <dt>Management</dt>
                <dd>
                  {statusText(
                    resource?.managementStatus.before?.value,
                    resource?.managementStatus.after?.value,
                  )}
                </dd>
                <dt>Deny</dt>
                <dd>{statusText(resource?.denyStatus.before?.value, resource?.denyStatus.after?.value)}</dd>
                {resource?.resourceGroup !== undefined && (
                  <>
                    <dt>Resource group</dt>
                    <dd>{resource.resourceGroup}</dd>
                  </>
                )}
                <dt>Resource id</dt>
                <dd>{row.resourceId.length > 0 ? row.resourceId : '—'}</dd>
              </dl>
            </section>

            <section className="section">
              <h3 className="section__head">Property changes</h3>
              {resource && resource.propertyChanges.length > 0 ? (
                <PropertyDeltaTree changes={resource.propertyChanges} hideNoise={props.hideNoise} />
              ) : (
                <p className="muted">No property-level changes reported.</p>
              )}
            </section>
          </>
        )}

        {stackDiagnostics.length > 0 && (
          <section className="section">
            <h3 className="section__head">Azure diagnostics</h3>
            {ownDiagnostics.length > 0 && (
              <>
                <p className="muted">About this resource</p>
                <DiagnosticList diagnostics={ownDiagnostics} />
              </>
            )}
            {otherDiagnostics.length > 0 && (
              <>
                <p className="muted">About this stack&rsquo;s what-if</p>
                <DiagnosticList diagnostics={otherDiagnostics} />
              </>
            )}
          </section>
        )}

        {/*
          Parity inputs read off the payload itself, not off a sidecar. The
          what-if result echoes actionOnUnmanage, denySettings and
          retentionInterval back, so there is nothing to keep in sync — and if
          these differ from what the deploy passes, the preview is a lie.
        */}
        {stack?.stack && (
          <section className="section">
            <h3 className="section__head">Stack settings</h3>
            <dl className="facts">
              <dt>Deny mode</dt>
              <dd>{stack.stack.denySettings?.mode?.value ?? '—'}</dd>
              <dt>On unmanage</dt>
              <dd>
                {stack.stack.actionOnUnmanage
                  ? Object.entries(stack.stack.actionOnUnmanage)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')
                  : '—'}
              </dd>
              <dt>Retention</dt>
              <dd>{stack.stack.retentionInterval ?? '—'}</dd>
              <dt>State</dt>
              <dd>{stack.stack.provisioningState ?? '—'}</dd>
              <dt>Correlation id</dt>
              <dd>{stack.stack.correlationId ?? '—'}</dd>
            </dl>
            {stack.stack.denySettingsWeakened && (
              <p className="reason__detail" style={{ color: `var(--w-${SEVERITY_TONE.protectionLoss})` }}>
                This stack&rsquo;s deny settings weaken in this run.
              </p>
            )}
          </section>
        )}

        {/* Everything the parser coped with. Surfaced, never swallowed. */}
        {stack && stack.warnings.length > 0 && (
          <section className="section">
            <h3 className="section__head">Parser warnings</h3>
            <ul className="notes">
              {stack.warnings.map((w, i) => (
                <li key={`${w.code}:${String(i)}`}>
                  {w.message}
                  {w.at !== undefined && <span className="muted"> — {w.at}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {stack && stack.notes.length > 0 && (
          <section className="section">
            <h3 className="section__head">Notes</h3>
            <ul className="notes">
              {stack.notes.map((n, i) => (
                <li key={String(i)}>{n}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
