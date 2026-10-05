import { describe, expect, it } from 'vitest';
import { describeLine, inferLines, roleOf, stemOf, type Pipeline, type PipelineFacts } from '../src/index.js';

let nextId = 1;
const pipe = (name: string, facts: PipelineFacts = {}, extra: Partial<Pipeline> = {}): Pipeline => ({
  id: nextId++,
  name,
  folder: '\\tools',
  repo: 'Apps',
  yamlPath: `pipelines/${name}.yaml`,
  disabled: false,
  runs: [],
  facts: { triggers: [], ...facts },
  ...extra,
});

const names = (estate: Pipeline[]) => {
  const { lines, suggestions } = inferLines(estate);
  const name = (id: number) => estate.find((p) => p.id === id)!.name;
  return {
    lines: lines.map((l) => `${l.name}: ${describeLine(l, estate)}`),
    suggestions: suggestions.map((s) => `${name(s.pipelines[0])} ~ ${name(s.pipelines[1])} (${s.signal})`),
  };
};

describe('stemOf and roleOf', () => {
  it('drops role words from the definition name', () => {
    expect(stemOf('db-tool-job-build')).toBe('db-tool');
    expect(stemOf('webapp-admin-ci')).toBe('webapp-admin');
    expect(stemOf('orders-unit-tests')).toBe('orders-tests');
    expect(stemOf('ci')).toBeNull();
  });

  it('labels a pipeline by its role words', () => {
    expect(roleOf('db-tool-job-build')).toBe('job-build');
    expect(roleOf('pricing-app-deploy')).toBe('deploy');
    expect(roleOf('smoke-environment')).toBeNull();
  });
});

describe('inferLines', () => {
  it('joins pipelines through a completion trigger, upstream first', () => {
    const estate = [pipe('x-deploy', { runsAfterAll: ['x-build'] }), pipe('x-build')];
    expect(names(estate).lines).toEqual(['x: build → deploy']);
  });

  it('follows every upstream, not only the first', () => {
    const estate = [pipe('a-build'), pipe('b-build'), pipe('c-deploy', { runsAfterAll: ['a-build', 'b-build'] })];
    expect(inferLines(estate).lines).toHaveLength(1);
    expect(inferLines(estate).lines[0]!.pipelines).toHaveLength(3);
  });

  it('joins a shared stem and a folder named after it, unlinked pipelines first', () => {
    const estate = [
      pipe('svc-deploy', { runsAfterAll: ['svc-build'] }),
      pipe('svc-build', { ciPaths: ['src/svc/*', 'src/shared-lib/*', 'src/uv.lock'] }),
      pipe('svc-ci', { ciPaths: ['src/svc/**'] }),
    ];
    const { lines } = inferLines(estate);
    expect(names(estate).lines).toEqual(['svc: ci, build → deploy']);
    expect(lines[0]!.formedBy).toEqual([{ kind: 'trigger' }, { kind: 'name and folder', folder: 'src/svc' }]);
  });

  it('matches a folder to a stem in any word order', () => {
    const estate = [pipe('admin-app-ci', { ciPaths: ['src/app-admin/**'] }), pipe('admin-app-build', { ciPaths: ['src/app-admin/*'] })];
    expect(names(estate).lines).toEqual(['admin-app: ci, build']);
  });

  it('ignores a folder named after no pipeline, however many share it', () => {
    const estate = [pipe('a-ci', { ciPaths: ['src/shared/*'] }), pipe('b-ci', { ciPaths: ['src/shared/*'] })];
    expect(names(estate)).toEqual({ lines: [], suggestions: [] });
  });

  it('suggests rather than groups on one signal', () => {
    const estate = [
      pipe('svc-ci', { ciPaths: ['src/svc/*'] }),
      pipe('svc-build', { ciPaths: ['src/svc/*'] }),
      pipe('svc-run'),
      pipe('other-ci', { ciPaths: ['src/svc/*', 'src/other/*'] }),
    ];
    expect(names(estate)).toEqual({
      lines: ['svc: ci, build'],
      suggestions: ['svc-ci ~ svc-run (name)', 'svc-ci ~ other-ci (folder)'],
    });
    expect(inferLines(estate).suggestions[1]!.folder).toBe('src/svc');
  });

  it('needs both signals on the same repo', () => {
    const estate = [pipe('svc-ci', { ciPaths: ['src/svc/*'] }), pipe('svc-build', { ciPaths: ['src/svc/*'] }, { repo: 'Other' })];
    expect(names(estate)).toEqual({ lines: [], suggestions: [] });
  });

  it('groups a declared component, across repos, and names the line after it', () => {
    const estate = [pipe('web-image', { component: 'portal' }), pipe('cdn-push', { component: 'portal' }, { repo: 'Other' })];
    const { lines } = inferLines(estate);
    expect(names(estate).lines).toEqual(['portal: web-image, cdn-push']);
    expect(lines[0]!.formedBy).toEqual([{ kind: 'component', component: 'portal' }]);
  });

  it('lets declared components override a trigger and silence suggestions', () => {
    const estate = [
      pipe('x-build', { component: 'x' }),
      pipe('x-deploy', { component: 'y', runsAfterAll: ['x-build'] }),
    ];
    expect(names(estate)).toEqual({ lines: [], suggestions: [] });
  });

  it('keeps pipelines without facts out', () => {
    const estate = [pipe('x-build'), { ...pipe('x-deploy', { runsAfterAll: ['x-build'] }), facts: {} }];
    expect(names(estate)).toEqual({ lines: [], suggestions: [] });
  });

  it('places a line in its most downstream pipeline’s folder', () => {
    const estate = [pipe('x-build', {}, { folder: '\\ci' }), pipe('x-deploy', { runsAfterAll: ['x-build'] }, { folder: '\\prod' })];
    expect(inferLines(estate).lines[0]!.folder).toBe('\\prod');
  });
});
