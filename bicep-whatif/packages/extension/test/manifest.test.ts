/**
 * Guards on `vss-extension.json`.
 *
 * Everything here fails silently in production if it drifts: a mismatched
 * `supportsTasks` GUID makes the tab invisible with no error anywhere, an
 * un-addressable `ui` folder serves a blank iframe, and a committed publisher
 * quietly forks the extension's identity the first time someone releases.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (rel: string): Record<string, any> =>
  JSON.parse(readFileSync(join(root, rel), 'utf8'));

const manifest = read('vss-extension.json');
const task = JSON.parse(readFileSync(join(root, '..', 'task', 'task.json'), 'utf8')) as Record<
  string,
  any
>;

const contribution = (type: string): Record<string, any> =>
  (manifest['contributions'] as Record<string, any>[]).find((c) => c['type'] === type)!;

const file = (path: string): Record<string, any> | undefined =>
  (manifest['files'] as Record<string, any>[]).find((f) => f['path'] === path);

describe('vss-extension.json — identity', () => {
  it('names no publisher', () => {
    // Decision F1. Extension identity is {publisher}.{id}; a committed value
    // would have to be edited to release, and the edit creates a DIFFERENT
    // extension with no upgrade path from the one people installed.
    expect(manifest).not.toHaveProperty('publisher');
  });

  it('keeps the extension id stable', () => {
    expect(manifest['id']).toBe('bicep-whatif');
  });

  it('is packaged from an overrides file that does name one', () => {
    const dev = read('overrides/dev.json');
    // Deliberately not pinned to a literal. Which personal publisher this is
    // depends on whose Marketplace account is in play, and pinning the string
    // only encoded an earlier guess at it — `MoneyMikeC`, which turned out not
    // to be a publisher that exists. A test that fails when the value is
    // corrected is testing the wrong thing. What has to hold is that packaging
    // has a real publisher to work with and that it is not the release template.
    expect(typeof dev['publisher']).toBe('string');
    expect(String(dev['publisher']).length).toBeGreaterThan(0);
    expect(String(dev['publisher'])).not.toMatch(/^REPLACE/);

    // This one is pinned, because it is the safety property rather than an
    // identity: sharing the dev extension into an organisation people rely on,
    // even once, creates an identity they must later be migrated off.
    expect(dev['public']).toBe(false);
  });

  it('gives the dev build a task identity of its own', () => {
    // One organisation runs dev builds beside release ones. Two installed tasks
    // cannot share a GUID, and a shared name makes `StackWhatIf@0` ambiguous.
    const dev = read('overrides/dev.json');
    const task = JSON.parse(readFileSync(join(root, '../task/task.json'), 'utf8')) as Record<string, any>;
    expect(dev['task']['id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(dev['task']['id']).not.toBe(task['id']);
    expect(dev['task']['name']).not.toBe(task['name']);
  });

  it('ships a release template that refuses to be used as-is', () => {
    const release = read('overrides/release.example.json');
    expect(String(release['publisher'])).toMatch(/^REPLACE/);
  });
});

describe('vss-extension.json — scopes', () => {
  it('asks for build read and nothing else', () => {
    // Decision F2. Scopes are the most visible thing a reviewer sees at install,
    // and "static SPA, build-read only, no egress" is an approval story that
    // survives review.
    expect(manifest['scopes']).toEqual(['vso.build']);
  });

  it('does not ask for anything that would complicate that story', () => {
    const scopes = manifest['scopes'] as string[];
    for (const forbidden of [
      'vso.build_execute',
      'vso.code',
      'vso.code_write',
      'vso.serviceendpoint',
      'vso.serviceendpoint_query',
      'vso.release',
      'vso.identity',
    ]) {
      expect(scopes).not.toContain(forbidden);
    }
  });
});

describe('vss-extension.json — contributions', () => {
  const tab = contribution('ms.vss-build-web.build-results-tab');
  const taskContribution = contribution('ms.vss-distributed-task.task');

  it('gates the tab on the task GUID that task.json actually declares', () => {
    // `supportsTasks` gates on the task being in the build definition, not on it
    // having run, and there is no runtime control over tab visibility. A
    // mismatch here makes the tab simply never appear, with nothing logged.
    expect(tab['properties']['supportsTasks']).toEqual([task['id']]);
  });

  it('points the tab at the built page', () => {
    expect(tab['properties']['uri']).toBe('ui/index.html');
    expect(tab['properties']['name']).toBe('What-If');
  });

  it('serves the tab from an addressable folder', () => {
    // An un-addressable folder is in the archive but not served, and the iframe
    // renders blank.
    expect(file('ui')?.['addressable']).toBe(true);
    expect(file('ui')?.['packagePath']).toBe('ui');
  });

  it('does NOT make the task folder addressable', () => {
    // The agent reads it out of the archive; serving it over HTTP would publish
    // the task's own dependencies for no reason.
    expect(file('task')?.['addressable']).toBe(false);
  });

  it('contributes the task from the folder that holds its manifest', () => {
    expect(taskContribution['properties']['name']).toBe('task');
    expect(taskContribution['targets']).toEqual(['ms.vss-distributed-task.tasks']);
  });

  it('targets the build results view', () => {
    expect(tab['targets']).toEqual(['ms.vss-build-web.build-results-view']);
  });
});

describe('vss-extension.json — assets', () => {
  it('references an icon that exists', () => {
    const icon = manifest['icons']['default'] as string;
    expect(existsSync(join(root, icon))).toBe(true);
  });

  it('references an overview that exists', () => {
    expect(existsSync(join(root, manifest['content']['details']['path'] as string))).toBe(true);
  });

  it('declares a version tfx can revise', () => {
    expect(manifest['version']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
