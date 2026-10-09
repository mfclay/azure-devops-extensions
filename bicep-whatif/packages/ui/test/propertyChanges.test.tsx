/**
 * @vitest-environment jsdom
 *
 * The property changes table. Its one rule worth a test of its own: the noise
 * toggle may hide a line only when that line says nothing. A real change that
 * goes missing behind "hide noise" is the failure that loses a reviewer's trust,
 * so most of what follows is about what must *stay* on screen.
 */
import type { PropertyChange } from '@bicep-whatif/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PropertyChanges } from '../src/components/PropertyChanges.js';

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

  it('flattens nested children, three levels deep, to dotted paths', () => {
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
    expect(paths()).toEqual(['properties.virtualNetworkPeerings.0.properties.allowGatewayTransit']);
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
      expect(paths()).toEqual(['properties.peerings.1.enabled', 'properties.sku']);
    });

    it('hides nothing when it is off', () => {
      render(<PropertyChanges changes={tree} hideNoise={false} />);
      expect(paths()).toContain('properties.type');
      expect(paths()).toContain('properties.subnets.0');
    });

    it('renders nothing when the whole list is noise', () => {
      const { container } = render(
        <PropertyChanges changes={[change({ path: 'x', changeType: 'noEffect' })]} hideNoise />,
      );
      expect(container.innerHTML).toBe('');
    });
  });
});
