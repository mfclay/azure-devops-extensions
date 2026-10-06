import { describe, expect, it } from 'vitest';
import { catalogKey, parseCatalog } from '../src/index.js';

const entry = (text: string, path: string) => parseCatalog(text).entries.get(catalogKey(path));

describe('parseCatalog', () => {
  it('reads each entry by its YAML path, with a folded purpose', () => {
    const text = [
      'pipelines:',
      '  pipelines/web-app-build.yaml:',
      '    owner: Platform Team',
      '    category: production',
      '    component: web-app',
      '    purpose: >-',
      '      Builds and pushes the web app image.',
      '      Its completion triggers web-app-deploy: Ring 0 first.',
      '    details: |',
      '      ## When it fails',
      '',
      '      Re-run it.',
      '',
    ].join('\n');
    expect(parseCatalog(text)).toEqual({
      problems: [],
      entries: new Map([
        [
          'pipelines/web-app-build.yaml',
          {
            path: 'pipelines/web-app-build.yaml',
            fields: {
              owner: 'Platform Team',
              category: 'production',
              component: 'web-app',
              purpose: 'Builds and pushes the web app image. Its completion triggers web-app-deploy: Ring 0 first.',
            },
            details: '## When it fails\n\nRe-run it.',
            problems: [],
          },
        ],
      ]),
    });
  });

  it('matches a path with any case, a leading slash or backslashes', () => {
    const text = 'pipelines:\n  /Pipelines\\Build.YAML:\n    owner: o\n';
    expect(entry(text, 'pipelines/build.yaml')).toMatchObject({ path: 'Pipelines/Build.YAML', fields: { owner: 'o' } });
  });

  it('keeps an entry with no fields, so the pipeline counts as listed', () => {
    expect(entry('pipelines:\n  pipelines/a.yaml:\n', 'pipelines/a.yaml')).toEqual({ path: 'pipelines/a.yaml', fields: {}, problems: [] });
  });

  it("flags an entry's problems and still supplies its other fields", () => {
    const text = 'pipelines:\n  pipelines/a.yaml:\n    owner: o\n    team: x\n    category: [a, b]\n    details: {a: 1}\n';
    expect(entry(text, 'pipelines/a.yaml')).toEqual({
      path: 'pipelines/a.yaml',
      fields: { owner: 'o' },
      problems: ["Unknown key 'team'.", "'category' should be text.", "'details' should be text."],
    });
    expect(entry('pipelines:\n  pipelines/a.yaml: just text\n', 'pipelines/a.yaml')?.problems).toEqual([
      'The entry should be a list of `key: value` lines.',
    ]);
    expect(entry('pipelines:\n  pipelines/a.md:\n    owner: o\n', 'pipelines/a.md')?.problems).toEqual(["'pipelines/a.md' is not a YAML file's path."]);
  });

  it('reads archived as true or false, and flags anything else', () => {
    expect(entry('pipelines:\n  pipelines/a.yaml:\n    archived: true\n', 'pipelines/a.yaml')).toEqual({ path: 'pipelines/a.yaml', fields: {}, archived: true, problems: [] });
    expect(entry('pipelines:\n  pipelines/a.yaml:\n    archived: false\n', 'pipelines/a.yaml')).toEqual({ path: 'pipelines/a.yaml', fields: {}, problems: [] });
    expect(entry('pipelines:\n  pipelines/a.yaml:\n    Archived: yes\n', 'pipelines/a.yaml')?.problems).toEqual(["'archived' should be true or false."]);
  });

  it('flags the same path listed twice and keeps the first', () => {
    const parsed = parseCatalog('pipelines:\n  pipelines/a.yaml:\n    owner: first\n  /pipelines/A.yaml:\n    owner: second\n');
    expect(parsed.problems).toEqual(["'pipelines/A.yaml' is listed twice; the first entry is used."]);
    expect(parsed.entries.get('pipelines/a.yaml')?.fields.owner).toBe('first');
  });

  it('flags sections it does not know, so a misspelt one is not silently ignored', () => {
    expect(parseCatalog('pipeline:\n  pipelines/a.yaml:\n    owner: o\n').problems).toEqual([
      "Unknown section 'pipeline'.",
      'The file has no `pipelines:` section.',
    ]);
    expect(parseCatalog('pipelines: {}\ncomponents: {}\n').problems).toEqual(["Unknown section 'components'."]);
  });

  it('says what is wrong with a file it cannot use', () => {
    expect(parseCatalog('').problems).toEqual(['The file is empty.']);
    // A document with nothing in it is empty too, not a file with no sections.
    expect(parseCatalog('---\n').problems).toEqual(['The file is empty.']);
    expect(parseCatalog('# owners go here\n  # later\n').problems).toEqual(['The file is empty.']);
    expect(parseCatalog('- a\n- b\n').problems).toEqual(['The file should be a set of sections, starting with `pipelines:`.']);
    expect(parseCatalog('pipelines: [a]\n').problems).toEqual(["`pipelines:` should map each pipeline's YAML path to its fields."]);
    const [invalid] = parseCatalog('pipelines:\n  a.yaml:\n    owner: o\n    owner: p\n').problems;
    expect(invalid).toMatch(/^The file is not valid YAML: duplicated mapping key/);
  });
});
