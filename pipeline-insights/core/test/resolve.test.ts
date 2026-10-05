import { describe, expect, it } from 'vitest';
import { resolveMetadata, type CatalogEntry } from '../src/index.js';

const ENTRY: CatalogEntry = {
  path: 'pipelines/thing-build.yaml',
  fields: { purpose: 'From the metadata file.', owner: 'Platform Team', category: 'service-production' },
  details: '## When it fails\n\nRe-run it.',
  problems: [],
};
const entry = (e: Partial<CatalogEntry>): CatalogEntry => ({ ...ENTRY, ...e });
const none = { runsAfter: [], stages: [] };

describe('resolveMetadata', () => {
  it("takes the metadata file's entry first", () => {
    expect(resolveMetadata('# A comment.\ntrigger: none\n', ENTRY, none)).toEqual({
      source: 'catalog',
      purpose: 'From the metadata file.',
      owner: 'Platform Team',
      category: 'service-production',
      details: '## When it fails\n\nRe-run it.',
      draft: false,
      problems: [],
    });
  });

  it('marks a purpose drafted with (TODO: verify), and reads an owner of TODO as not set', () => {
    const m = resolveMetadata(null, entry({ fields: { purpose: 'Builds the image. Its completion triggers\n thing-deploy. (TODO: verify)', owner: 'TODO' } }), none);
    expect(m.purpose).toBe('Builds the image. Its completion triggers thing-deploy.');
    expect(m.draft).toBe(true);
    expect(m.owner).toBeUndefined();
  });

  it('is not a draft for spanning lines or spacing alone', () => {
    // A derived purpose is a comment paragraph: its line breaks and double spaces are flattened,
    // and that alone once marked it draft.
    const yaml = '# Stage 1 — Build: two parallel jobs:\n#   • API — restore,  build\n#   • Gateway — publish (no tests)\ntrigger: none\n';
    const m = resolveMetadata(yaml, null, none);
    expect(m.source).toBe('derived');
    expect(m.purpose).toBe('Stage 1 — Build: two parallel jobs: • API — restore, build • Gateway — publish (no tests)');
    expect(m.draft).toBe(false);
  });

  it("passes on an entry's problems", () => {
    expect(resolveMetadata(null, entry({ problems: ["Unknown key 'team'."] }), none).problems).toEqual(["Unknown key 'team'."]);
  });

  it("derives a purpose from the first paragraph of the YAML's opening comment", () => {
    const yaml = '# yaml-language-server: $schema=x\n# Builds the thing\n# and pushes it.\n#\n# Notes: more.\n\ntrigger: none\n';
    expect(resolveMetadata(yaml, null, none)).toEqual({ source: 'derived', purpose: 'Builds the thing and pushes it.', draft: false, problems: [] });
  });

  it('passes over a banner title for the paragraph under it', () => {
    const banner = '# =========\n#    Build Pricing App Pipeline\n# =========\n';
    const yaml = `${banner}# Builds and pushes\n# the image.\n#\n# More.\n\ntrigger: none\n`;
    expect(resolveMetadata(yaml, null, none).purpose).toBe('Builds and pushes the image.');
    expect(resolveMetadata(`${banner}trigger: none\n`, null, none).purpose).toBe('Build Pricing App Pipeline');
    expect(resolveMetadata('# Title\n# ====\n# Body.\n', null, none).purpose).toBe('Title');
  });

  it('falls back to a structural summary from the triggers and the newest run', () => {
    const m = resolveMetadata('trigger: none\n', null, {
      runsAfter: ['thing-build'],
      stages: ['Build', 'Ring-1 Staging', 'Ring-2 Production'],
    });
    expect(m).toEqual({
      source: 'structural',
      purpose: 'Runs after thing-build; 3 stages ending in Ring-2 Production',
      draft: false,
      problems: [],
    });
    expect(resolveMetadata('trigger: none\n', null, { runsAfter: [], stages: ['Build'] }).purpose).toBe('1 stage, Build');
    // The implicit stage of a pipeline without stages says nothing.
    expect(resolveMetadata('trigger: none\n', null, { runsAfter: [], stages: ['__default'] }).source).toBe('none');
  });

  it('has no description when nothing says anything', () => {
    expect(resolveMetadata('trigger: none\n', null, none)).toEqual({ source: 'none', draft: false, problems: [] });
    expect(resolveMetadata(null, null, none)).toEqual({ source: 'none', draft: false, problems: [] });
  });

  it("keeps an entry's owner when the purpose has to come from elsewhere", () => {
    const m = resolveMetadata('# Builds the thing.\ntrigger: none\n', { path: ENTRY.path, fields: { owner: 'Platform Team' }, problems: [] }, none);
    expect(m).toEqual({ source: 'derived', purpose: 'Builds the thing.', owner: 'Platform Team', draft: false, problems: [] });
  });
});
