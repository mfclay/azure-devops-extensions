/**
 * @vitest-environment jsdom
 *
 * The loading screen: what it says in each phase, and how many of its sketch's
 * lines have settled for a given count. The animation and the delay before it
 * appears are CSS, which jsdom does not run.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Loading, progressText, settledLines } from '../src/components/Loading.js';

afterEach(cleanup);

function settled(): number {
  return document.querySelectorAll('.loading__line[data-settled="true"]').length;
}

describe('progressText', () => {
  it('says what it is doing before it knows how many stacks there are', () => {
    expect(progressText({ phase: 'finding' })).toBe('Finding the what-if stages');
  });

  it('counts the stacks read, in the singular for one', () => {
    expect(progressText({ phase: 'reading', read: 4, total: 9 })).toBe('4 of 9 stacks read');
    expect(progressText({ phase: 'reading', read: 0, total: 1 })).toBe('0 of 1 stack read');
  });
});

describe('settledLines', () => {
  it('settles lines in proportion to the stacks read', () => {
    expect(settledLines({ phase: 'finding' })).toBe(0);
    expect(settledLines({ phase: 'reading', read: 0, total: 9 })).toBe(0);
    expect(settledLines({ phase: 'reading', read: 4, total: 9 })).toBe(4);
    expect(settledLines({ phase: 'reading', read: 9, total: 9 })).toBe(8);
    expect(settledLines({ phase: 'reading', read: 30, total: 60 })).toBe(4);
  });

  it('settles nothing for a build with no stacks to read', () => {
    expect(settledLines({ phase: 'reading', read: 0, total: 0 })).toBe(0);
  });
});

describe('Loading', () => {
  it('says what it is reading, in the headline’s place', () => {
    render(<Loading progress={{ phase: 'finding' }} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Reading the build’s what-if results');
    expect(status.textContent).toContain('Finding the what-if stages');
    expect(settled()).toBe(0);
  });

  it('counts the stacks and settles lines as they are read', () => {
    render(<Loading progress={{ phase: 'reading', read: 4, total: 9 }} />);
    expect(screen.getByRole('status').textContent).toContain('4 of 9 stacks read');
    expect(settled()).toBe(4);
  });

  it('keeps the sketch away from assistive technology', () => {
    render(<Loading progress={{ phase: 'reading', read: 1, total: 2 }} />);
    for (const el of document.querySelectorAll('.loading__toolbar, .loading__list')) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
