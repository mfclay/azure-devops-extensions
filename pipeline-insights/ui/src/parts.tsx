import type { Phrase, Stage } from '@pipeline-insights/core';
import type { ReactNode } from 'react';
import { stageTone, stageWord, type Tone } from './display.js';

const GLYPHS: Partial<Record<Tone, ReactNode>> = {
  ok: <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  fail: <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" />,
  wait: (
    <>
      <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3.6V6l1.7 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  run: <path d="M4 2.5l5 3.5-5 3.5z" fill="currentColor" />,
  cancel: <path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" />,
  partial: <path d="M6 2.5v4.5M6 8.6v.9" stroke="currentColor" strokeWidth="1.8" />,
  idle: <path d="M8.5 7.6A3.6 3.6 0 0 1 4.4 3.5a3.6 3.6 0 1 0 4.1 4.1z" fill="currentColor" />,
  info: <path d="M6 5v4M6 3v.5" stroke="currentColor" strokeWidth="1.8" />,
};

export function StateIcon({ tone }: { tone: Tone }) {
  const glyph = GLYPHS[tone];
  return (
    <span className={`pi-ico pi-ico-${tone}`} aria-hidden="true">
      {glyph && <svg viewBox="0 0 12 12">{glyph}</svg>}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`pi-dot pi-s-${tone}`} aria-hidden="true" />;
}

/** A phrase from core, with stage names and literals emphasised. */
export function PhraseView({ phrase }: { phrase: Phrase }) {
  return (
    <>
      {phrase.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : 'stage' in part ? (
          <span key={i} className="pi-stage-name">
            {part.stage}
          </span>
        ) : (
          <code key={i}>{part.code}</code>
        ),
      )}
    </>
  );
}

/** Backticks in a trigger line mark names, branches and paths; they are shown bold. */
export function TriggerLine({ line }: { line: string }) {
  return <>{line.split('`').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>;
}

/** One segment per stage, so a 33-stage run still fits a row. */
export function StageStrip({ stages }: { stages: Stage[] }) {
  return (
    <span className="pi-stages">
      {stages.map((s, i) => (
        <i key={i} className={`pi-s-${stageTone(s)}`} data-tip={`${s.name} · ${stageWord(s)}`} />
      ))}
    </span>
  );
}

/** A quick filter in the controls row: "Repo Any", tinted while one is picked. */
export function QuickFilter({ label, values, value, onChange }: { label: string; values: string[]; value: string | null; onChange(value: string | null): void }) {
  return (
    <label className="pi-pick" data-set={value !== null}>
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Any</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
