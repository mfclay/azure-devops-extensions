/**
 * @vitest-environment jsdom
 *
 * The property changes table. Its one rule worth a test of its own: the noise
 * toggle may hide a line only when that line says nothing. A real change that
 * goes missing behind "hide noise" is the failure that loses a reviewer's trust,
 * so most of what follows is about what must *stay* on screen.
 */
import { normalizeStackWhatIf, type PropertyChange } from '@bicep-whatif/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PropertyChanges } from '../src/components/PropertyChanges.js';
import { fixture } from './fixtures.js';

function change(over: Partial<PropertyChange> & Pick<PropertyChange, 'path'>): PropertyChange {
  return {
    changeType: 'modify',
    changeTypeKnown: true,
    before: undefined,
    after: undefined,
    children: [],
    ...over,
  };
}

afterEach(cleanup);

function paths(): string[] {
  return [...document.querySelectorAll('.delta__path')].map((e) => e.textContent ?? '');
}

describe('PropertyChanges', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<PropertyChanges changes={[]} hideNoise={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('draws before → after for a scalar change', () => {
    render(
      <PropertyChanges
        changes={[change({ path: 'properties.publicNetworkAccess', before: 'Enabled', after: 'Disabled' })]}
        hideNoise={false}
      />,
    );
    expect(document.querySelector('.val--before')?.textContent).toBe('Enabled');
    expect(document.querySelector('.val--after')?.textContent).toBe('Disabled');
  });

  it('gives the property enum its own word marks, not the resource glyphs', () => {
    render(
      <PropertyChanges
        changes={[
          change({ path: 'a', changeType: 'create', after: 1 }),
          change({ path: 'b', changeType: 'delete', before: 1 }),
          change({ path: 'c', changeType: 'modify', before: 1, after: 2 }),
          change({ path: 'd', changeType: 'array' }),
          change({ path: 'e', changeType: 'noEffect' }),
        ]}
        hideNoise={false}
      />,
    );
    const marks = [...document.querySelectorAll('.delta__mark')].map((e) => e.textContent);
    expect(marks).toEqual(['add', 'del', 'mod', 'arr', 'noop']);
  });

  it('shows an unrecognised change type verbatim and flags it as unknown', () => {
    render(
      <PropertyChanges
        changes={[change({ path: 'properties.futureThing', changeType: 'teleport', changeTypeKnown: false, after: 'x' })]}
        hideNoise={false}
      />,
    );
    const mark = document.querySelector('.delta__mark');
    expect(mark?.textContent).toBe('teleport');
    expect(mark?.getAttribute('data-known')).toBe('false');
  });

  it('renders every kind of leaf value legibly', () => {
    const long = { blob: 'x'.repeat(300) };
    render(
      <PropertyChanges
        changes={[
          change({ path: 'absent', changeType: 'create', before: undefined, after: null }),
          change({ path: 'empty', before: '', after: 'set' }),
          change({ path: 'scalar', before: 3, after: false }),
          change({ path: 'object', before: { a: 1 }, after: long }),
        ]}
        hideNoise={false}
      />,
    );
    const before = [...document.querySelectorAll('.val--before')].map((e) => e.textContent);
    const after = [...document.querySelectorAll('.val--after')].map((e) => e.textContent);
    expect(before).toEqual(['absent', 'empty', '3', '{"a":1}']);
    expect(after[0]).toBe('null');
    expect(after[2]).toBe('false');
    // Long JSON is clipped so the row stays scannable.
    expect(after[3]).toHaveLength(158);
    expect(after[3]?.endsWith('…')).toBe(true);
  });

  it('does not draw null → null under container nodes', () => {
    render(
      <PropertyChanges
        changes={[change({ path: 'properties.subnets', changeType: 'array', before: null, after: null })]}
        hideNoise={false}
      />,
    );
    expect(paths()).toEqual(['properties.subnets']);
    expect(document.querySelector('.val')).toBeNull();
  });

  it('says plainly that a noEffect property will be ignored', () => {
    render(<PropertyChanges changes={[change({ path: 'type', changeType: 'noEffect' })]} hideNoise={false} />);
    expect(screen.getByText(/the provider will ignore this property/i)).toBeTruthy();
  });

  it('flattens nested children, three levels deep, to one path, indexes in brackets', () => {
    render(
      <PropertyChanges
        changes={[
          change({
            path: 'properties.virtualNetworkPeerings',
            changeType: 'array',
            children: [
              change({
                path: '0',
                children: [change({ path: 'properties.allowGatewayTransit', before: true, after: false })],
              }),
            ],
          }),
        ]}
        hideNoise={false}
      />,
    );
    // The containers hold only children, so their children's paths name them.
    expect(paths()).toEqual(['properties.virtualNetworkPeerings[0].properties.allowGatewayTransit']);
  });

  describe('with hide noise on', () => {
    const tree = [
      change({ path: 'properties.type', changeType: 'noEffect', before: 'a', after: 'b' }),
      change({
        path: 'properties.subnets',
        changeType: 'array',
        children: [change({ path: '0', changeType: 'noEffect' })],
      }),
      change({
        path: 'properties.peerings',
        changeType: 'array',
        children: [
          change({ path: '0', changeType: 'noEffect' }),
          change({ path: '1', children: [change({ path: 'enabled', before: true, after: false })] }),
        ],
      }),
      change({ path: 'properties.sku', before: 'Basic', after: 'Premium' }),
    ];

    it('hides noEffect lines and everything under containers holding only noise', () => {
      render(<PropertyChanges changes={tree} hideNoise />);
      expect(paths()).not.toContain('properties.type');
      expect(paths().some((p) => p.startsWith('properties.subnets'))).toBe(false);
    });

    it('keeps every real change, with its full path', () => {
      render(<PropertyChanges changes={tree} hideNoise />);
      expect(paths()).toEqual(['properties.peerings[1].enabled', 'properties.sku']);
    });

    it('hides nothing when it is off', () => {
      render(<PropertyChanges changes={tree} hideNoise={false} />);
      expect(paths()).toContain('properties.type');
      expect(paths()).toContain('properties.subnets[0]');
    });

    it('renders nothing when the whole list is noise', () => {
      const { container } = render(
        <PropertyChanges changes={[change({ path: 'x', changeType: 'noEffect' })]} hideNoise />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('the app-cus-vnet capture, grouped', () => {
    const VNET = (() => {
      const stack = normalizeStackWhatIf(fixture('real/build-7700017-app-network.json'));
      const row = stack.rows.find((r) => r.name === 'app-cus-vnet');
      if (!row) throw new Error('app-cus-vnet not in the capture');
      return row.propertyChanges;
    })();

    function groups(): HTMLElement[] {
      return screen.getAllByRole('button', { expanded: true }).concat(screen.queryAllByRole('button', { expanded: false }));
    }

    it('counts the lines in its header, the ignored ones apart', () => {
      render(<PropertyChanges changes={VNET} hideNoise={false} />);
      expect(document.querySelector('.delta__tally')?.textContent).toBe(
        '15 property changes: 1 added, 14 removed · 2 ignored by the provider',
      );
    });

    it('draws the two removed peerings as two open groups, of 6 and 7', () => {
      render(<PropertyChanges changes={VNET} hideNoise={false} />);
      const rows = groups();
      expect(rows.map((b) => b.querySelector('.delta__mark')?.textContent)).toEqual(['del ×6', 'del ×7']);
      for (const b of rows) {
        expect(b.getAttribute('aria-expanded')).toBe('true');
        // Never "removed": the element stays, its properties go.
        expect(b.textContent).toMatch(/All \d properties become absent/);
        expect(b.querySelector('button')).toBeNull();
      }
      // Open, the lines show their values, the after side as absent.
      expect(document.querySelectorAll('.delta__path')).not.toHaveLength(0);
      expect(screen.getAllByText('absent').length).toBeGreaterThanOrEqual(13);
    });

    it('folds a group to its row, saying how many it holds, and opens it again', () => {
      render(<PropertyChanges changes={VNET} hideNoise={false} />);
      const before = document.querySelectorAll('tbody tr').length;
      const seven = groups()[1]!;
      fireEvent.click(seven);
      expect(seven.getAttribute('aria-expanded')).toBe('false');
      expect(seven.textContent).toMatch(/Show 7$/);
      expect(document.querySelectorAll('tbody tr')).toHaveLength(before - 7);
      fireEvent.click(seven);
      expect(document.querySelectorAll('tbody tr')).toHaveLength(before);
    });

    it('opens a folded group when the search finds a line inside it', () => {
      const { rerender } = render(<PropertyChanges changes={VNET} hideNoise={false} query="" />);
      const seven = groups()[1]!;
      fireEvent.click(seven);
      expect(seven.getAttribute('aria-expanded')).toBe('false');
      rerender(<PropertyChanges changes={VNET} hideNoise={false} query="peerings.1.properties.peeringSyncLevel" />);
      expect(groups()[1]!.getAttribute('aria-expanded')).toBe('true');
    });

    it('folds the lines the provider ignores into one', () => {
      render(<PropertyChanges changes={VNET} hideNoise={false} />);
      const ignored = document.querySelector<HTMLElement>('.delta__ignored')!;
      expect(ignored.querySelector('.delta__mark')?.textContent).toBe('noop ×2');
      expect(ignored.textContent).toMatch(/the provider will ignore these\.$/);
    });
  });
});
