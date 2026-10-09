/**
 * @vitest-environment jsdom
 *
 * The rung icons. The tab draws icons where the log prints `core`'s text
 * glyphs, so each icon's tooltip has to name the glyph it stands for, and each
 * has to carry the rung's word for anyone who can't see it.
 */
import { SEVERITIES, SEVERITY_GLYPH } from '@bicep-whatif/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Glyph, SEVERITY_LABEL, WarningIcon } from '../src/components/Glyph.js';

afterEach(cleanup);

describe('Glyph', () => {
  it('names the rung, and ties the icon to the log glyph in its tooltip', () => {
    render(<Glyph severity="destructive" />);
    const icon = screen.getByRole('img', { name: 'destructive' });
    expect(icon.querySelector('title')?.textContent).toBe('Destructive (-)');
  });

  it('takes every tooltip glyph from core, so unchanged reads (*), not (=)', () => {
    for (const rung of SEVERITIES) {
      const { container } = render(<Glyph severity={rung} />);
      expect(container.querySelector('title')?.textContent).toMatch(
        new RegExp(`^${SEVERITY_LABEL[rung]} \\(\\${SEVERITY_GLYPH[rung]}\\)$`, 'i'),
      );
      cleanup();
    }
    render(<Glyph severity="noChange" />);
    expect(screen.getByRole('img').querySelector('title')?.textContent).toBe('Unchanged (*)');
  });

  it('says "not evaluated" where the context gives it, keeping the glyph', () => {
    render(<Glyph severity="unevaluated" label="not evaluated" />);
    const icon = screen.getByRole('img', { name: 'not evaluated' });
    expect(icon.querySelector('title')?.textContent).toBe('Not evaluated (?)');
  });

  it('carries the rung tone and the size asked for', () => {
    render(<Glyph severity="create" size={18} />);
    const icon = screen.getByRole('img', { name: 'new' });
    expect(icon.getAttribute('data-tone')).toBe('positive');
    expect(icon.getAttribute('width')).toBe('18');
  });

  it('is hidden and unnamed when the word sits beside it', () => {
    const { container } = render(<Glyph severity="modify" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('title')).toBeNull();
  });
});

describe('WarningIcon', () => {
  it('is a named 16px icon in the warning tone', () => {
    render(<WarningIcon />);
    const icon = screen.getByRole('img', { name: 'warning' });
    expect(icon.getAttribute('data-tone')).toBe('warning');
    expect(icon.getAttribute('width')).toBe('16');
  });
});
