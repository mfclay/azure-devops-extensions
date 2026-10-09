import { needsAttention, SEVERITY_TONE, type WhatIfDiagnostic } from '@bicep-whatif/core';
import { useState } from 'react';
import { diagnosticsDisclosure, incompleteCallout } from '../model/diagnostics.js';
import type { StackView } from '../model/estate.js';
import { WarningIcon } from './Glyph.js';

export function DiagnosticList({ diagnostics }: { diagnostics: readonly WhatIfDiagnostic[] }): React.ReactElement {
  return (
    <ul className="notes">
      {diagnostics.map((d, i) => (
        <li key={`${d.code ?? ''}:${String(i)}`} data-level={needsAttention(d) ? 'warning' : 'info'}>
          <strong>{d.level}</strong>
          {d.code !== undefined && <span className="muted"> {d.code}</span>} — {d.message}
          {d.target !== undefined && <span className="muted"> — {d.target}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One label and value. A `div` around each pair keeps `dt` and `dd` siblings. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * What is true of a whole stack rather than of one resource in it: why it was
 * not evaluated, Azure's diagnostics on its what-if, the settings the what-if
 * echoed back, and what the parser coped with.
 *
 * These used to sit in banners above the table and again under every row's
 * details. They are said once now, where the stack is opened.
 *
 * When Azure warned, what that means for this stack comes first, in plain
 * words. Azure's own text, which is written for a log and shouts, sits behind
 * a disclosure under it, warnings first.
 */
export function StackDetail({ stack }: { stack: StackView }): React.ReactElement {
  const s = stack.stack;
  const diagnostics = [...(s?.diagnostics ?? [])].sort(
    (a, b) => Number(needsAttention(b)) - Number(needsAttention(a)),
  );
  const callout = incompleteCallout(stack);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const azureText = diagnostics.length > 0 && (
    <>
      <button
        type="button"
        className="linkbtn disclosure"
        aria-expanded={showDiagnostics}
        onClick={() => {
          setShowDiagnostics((v) => !v);
        }}
      >
        <span className="chev" aria-hidden="true">
          {showDiagnostics ? '▾' : '▸'}
        </span>
        {diagnosticsDisclosure(diagnostics)}
      </button>
      {showDiagnostics && <DiagnosticList diagnostics={diagnostics} />}
    </>
  );

  return (
    <div className="stackdetail" role="region" aria-label={`About stack ${stack.label}`}>
      {stack.notEvaluatedDetail !== undefined && <p className="stackdetail__lead">{stack.notEvaluatedDetail}</p>}

      {callout !== undefined ? (
        <div className="callout" role="note">
          <WarningIcon />
          <div className="callout__body">
            <p className="callout__title">{callout.title}</p>
            <p className="callout__text">{callout.body}</p>
            {azureText}
          </div>
        </div>
      ) : (
        azureText
      )}

      {s?.denySettingsWeakened === true && (
        <p className="stackdetail__lead" style={{ color: `var(--w-${SEVERITY_TONE.protectionLoss})` }}>
          This stack&rsquo;s deny settings weaken in this run.
        </p>
      )}

      {/*
        Parity inputs read off the payload itself, not off a sidecar. The
        what-if result echoes actionOnUnmanage, denySettings and
        retentionInterval back, so there is nothing to keep in sync — and if
        these differ from what the deploy passes, the preview is a lie.
      */}
      <dl className="facts">
        <Fact label="Stage">
          {stack.stageDisplayName}
          {stack.stageDisplayName !== stack.stageId && <span className="muted"> ({stack.stageId})</span>}
        </Fact>
        {s && (
          <>
            <Fact label="Deny mode">{s.denySettings?.mode?.value ?? '—'}</Fact>
            <Fact label="On unmanage">
              {s.actionOnUnmanage
                ? Object.entries(s.actionOnUnmanage)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')
                : '—'}
            </Fact>
            <Fact label="Retention">{s.retentionInterval ?? '—'}</Fact>
            <Fact label="State">{s.provisioningState ?? '—'}</Fact>
            <Fact label="Correlation id">{s.correlationId ?? '—'}</Fact>
          </>
        )}
      </dl>

      {/* Everything the parser coped with. Surfaced, never swallowed. */}
      {stack.warnings.length > 0 && (
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

      {stack.notes.length > 0 && (
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
  );
}
