/**
 * @vitest-environment jsdom
 *
 * The property delta tree. Its one rule worth a test of its own: the noise
 * toggle may hide a node only when that node says nothing. A real change that
 * goes missing behind "hide noise" is the failure that loses a reviewer's trust,
 * so most of what follows is about what must *stay* on screen.
 */
import type { PropertyChange } from '@bicep-whatif/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PropertyDeltaTree } from '../src/components/PropertyDeltaTree.js';

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

describe('PropertyDeltaTree', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<PropertyDeltaTree changes={[]} hideNoise={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('draws before → after for a scalar change', () => {
    render(
      <PropertyDeltaTree
        changes={[change({ path: 'properties.publicNetworkAccess', before: 'Enabled', after: 'Disabled' })]}
        hideNoise={false}
      />,
    );
    expect(document.querySelector('.val--before')?.textContent).toBe('Enabled');
    expect(document.querySelector('.val--after')?.textContent).toBe('Disabled');
  });

  it('gives the property enum its own word marks, not the resource glyphs', () => {
    render(
      <PropertyDeltaTree
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
      <PropertyDeltaTree
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
      <PropertyDeltaTree
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
      <PropertyDeltaTree
        changes={[change({ path: 'properties.subnets', changeType: 'array', before: null, after: null })]}
        hideNoise={false}
      />,
    );
    expect(document.querySelector('.delta__values')).toBeNull();
  });

  it('says plainly that a noEffect property will be ignored', () => {
    render(<PropertyDeltaTree changes={[change({ path: 'type', changeType: 'noEffect' })]} hideNoise={false} />);
    expect(screen.getByText(/the provider will ignore this property/i)).toBeTruthy();
  });

  it('recurses through nested children, three levels deep', () => {
    render(
      <PropertyDeltaTree
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
    expect(paths()).toEqual(['properties.virtualNetworkPeerings', '0', 'properties.allowGatewayTransit']);
    expect(document.querySelectorAll('.delta--nested')).toHaveLength(2);
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

    it('hides noEffect nodes and containers holding only noise', () => {
      render(<PropertyDeltaTree changes={tree} hideNoise />);
      expect(paths()).not.toContain('properties.type');
      expect(paths()).not.toContain('properties.subnets');
    });

    it('keeps every node on the way down to a real change', () => {
      render(<PropertyDeltaTree changes={tree} hideNoise />);
      expect(paths()).toEqual(['properties.peerings', '1', 'enabled', 'properties.sku']);
    });

    it('hides nothing when it is off', () => {
      render(<PropertyDeltaTree changes={tree} hideNoise={false} />);
      expect(paths()).toContain('properties.type');
      expect(paths()).toContain('properties.subnets');
    });

    it('renders nothing when the whole list is noise', () => {
      const { container } = render(
        <PropertyDeltaTree changes={[change({ path: 'x', changeType: 'noEffect' })]} hideNoise />,
      );
      expect(container.innerHTML).toBe('');
    });
  });
});
