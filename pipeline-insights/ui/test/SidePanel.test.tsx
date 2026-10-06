/** @vitest-environment jsdom */
import { pipelineState, type Pipeline, type PipelineFacts, type PipelineRun, type Stage } from '@pipeline-insights/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { adoLinks } from '../src/index.js';
import { SidePanel } from '../src/SidePanel.js';

const NOW = Date.parse('2026-10-03T18:30:00.000Z');
const options = { windowDays: 14 as const, mainOnly: true, now: NOW };
const links = adoLinks('https://dev.azure.com/contoso', 'Platform');

const stage = (name: string, over: Partial<Stage> = {}): Stage => ({ name, state: 'completed', result: 'succeeded', waitingForApproval: false, ...over });

let nextRun = 100;
const run = (hoursAgo: number, over: Partial<PipelineRun> = {}): PipelineRun => {
  const queued = new Date(NOW - hoursAgo * 3600_000).toISOString();
  const id = nextRun++;
  return {
    id,
    number: `20261003.${id}`,
    status: 'completed',
    result: 'succeeded',
    reason: 'individualCI',
    branch: 'main',
    queued,
    started: queued,
    finished: new Date(Date.parse(queued) + 600_000).toISOString(),
    commit: 'abc123',
    stages: [stage('Build')],
    ...over,
  };
};

const pipeline = (facts: PipelineFacts, over: Partial<Pipeline> = {}): Pipeline => ({
  id: 7,
  name: 'web-deploy',
  folder: '\\services',
  repo: 'web',
  yamlPath: 'pipelines/deploy.yaml',
  disabled: false,
  runs: [run(2)],
  facts,
  ...over,
});

const panel = (p: Pipeline, props: Partial<Parameters<typeof SidePanel>[0]> = {}) =>
  render(<SidePanel a={pipelineState(p, options)} windowDays={14} mainOnly now={NOW} links={links} onClose={() => {}} {...props} />);
const dialog = () => within(screen.getByRole('dialog'));
/** The value under a heading in the panel's facts. */
const fact = (term: string) => dialog().getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;

afterEach(cleanup);

describe('SidePanel', () => {
  it("says why a retired pipeline raises nothing: where it was archived, or that it is disabled", () => {
    panel(pipeline({ archived: true, metadataFile: 'deploy/pipelines.meta.yaml' }));
    expect(dialog().getByText('Archived in deploy/pipelines.meta.yaml.')).toBeTruthy();
    cleanup();
    panel(pipeline({ archived: true }));
    expect(dialog().getByText('Archived in pipelines.meta.yaml.')).toBeTruthy();
    cleanup();
    panel(pipeline({}, { disabled: true }));
    expect(dialog().getByText('Disabled in Azure DevOps.')).toBeTruthy();
    cleanup();
    panel(pipeline({}));
    expect(dialog().queryByText(/Archived in|Disabled in/)).toBeNull();
  });

  it("shows every field the entry declares, and what to fix in it", () => {
    panel(
      pipeline({
        purpose: 'Deploys the web app.',
        purposeSource: 'catalog',
        described: true,
        owner: 'Web Team',
        category: 'Deploy',
        component: 'web',
        details: 'Ring 0 first, then the rest.',
        metadataFile: 'pipelines/pipelines.meta.yaml',
        metadataProblems: ["Unknown key 'colour'.", "'archived' should be true or false."],
      }),
    );
    expect(fact('Purpose').textContent).toBe('Deploys the web app.');
    expect(fact('Owner').textContent).toBe('Web Team');
    expect(fact('Category').textContent).toBe('Deploy');
    expect(fact('Component').textContent).toBe('web');
    expect(dialog().getByRole('heading', { name: 'Notes' }).nextElementSibling?.textContent).toBe('Ring 0 first, then the rest.');
    const problems = within(fact('To fix')).getAllByRole('listitem');
    expect(problems.map((li) => li.textContent)).toEqual(["Unknown key 'colour'.", "'archived' should be true or false."]);
    expect(dialog().getByRole('link', { name: 'Edit description' })).toBeTruthy();
  });

  it('leaves out what the entry does not declare, and never shows a TODO owner', () => {
    panel(pipeline({ owner: 'todo', triggers: [] }, { yamlPath: '' }));
    expect(fact('Purpose').textContent).toBe('No description');
    expect(fact('Owner').textContent).toBe('not set');
    expect(fact('Triggers').textContent).toBe('—');
    expect(fact('YAML').textContent).toBe('—');
    for (const term of ['Category', 'Component', 'To fix']) expect(dialog().queryByText(term, { selector: 'dt' })).toBeNull();
    expect(dialog().queryByRole('heading', { name: 'Notes' })).toBeNull();
    expect(dialog().queryByRole('link', { name: 'View YAML' })).toBeNull();
  });

  it('marks a purpose by how sure it is', () => {
    const tag = () => fact('Purpose').querySelector('.pi-tag');
    panel(pipeline({ purpose: '1 stage, Build', purposeSource: 'structural' }));
    expect(tag()?.textContent).toBe('summary');
    expect(tag()?.getAttribute('title')).toBe('From the triggers and the newest run');
    cleanup();
    panel(pipeline({ purpose: 'Deploys it.', purposeSource: 'catalog', draft: true }));
    expect(tag()?.textContent).toBe('draft');
    cleanup();
    panel(pipeline({ purpose: 'Deploys it.', purposeSource: 'catalog' }));
    expect(tag()).toBeNull();
  });

  it("offers to create the metadata file in the repo's well-known folder when there is none", () => {
    panel(pipeline({ metadataFolder: '.azuredevops' }));
    const add = dialog().getByRole('link', { name: 'Add a description' });
    expect(add.getAttribute('title')).toBe('Create pipelines.meta.yaml here');
    expect(add.getAttribute('href')).toBe('https://dev.azure.com/contoso/Platform/_git/web?path=/.azuredevops');
  });

  it('says when there are no runs to show', () => {
    panel(pipeline({}, { runs: [] }));
    expect(dialog().getByRole('heading', { name: 'Recent runs on main' })).toBeTruthy();
    expect(dialog().getByText('No runs.')).toBeTruthy();
    cleanup();
    render(<SidePanel a={pipelineState(pipeline({}, { runs: [] }), { ...options, mainOnly: false })} windowDays={14} mainOnly={false} now={NOW} links={links} onClose={() => {}} />);
    expect(dialog().getByRole('heading', { name: 'Recent runs' })).toBeTruthy();
  });

  it("lists a run's stages by how each went, and marks the ones that need a look", () => {
    const stages = [
      stage('Build'),
      stage('Test', { result: 'succeededWithIssues' }),
      stage('Ring 0', { result: 'failed' }),
      stage('Ring 1', { state: 'inProgress', result: null }),
      stage('Ring 2', { state: 'pending', result: null, waitingForApproval: true }),
      stage('Ring 3', { state: 'pending', result: null }),
      stage('Cleanup', { result: 'skipped' }),
    ];
    panel(pipeline({}, { runs: [run(1, { status: 'inProgress', result: null, finished: null, stages })] }));
    const rows = [...screen.getByRole('dialog').querySelectorAll('.pi-stage-list > div')];
    expect(rows.map((r) => [r.textContent, r.querySelector('i')?.className, r.className])).toEqual([
      ['Build · succeeded', 'pi-s-ok', ''],
      ['Test · succeeded with issues', 'pi-s-partial', ''],
      ['Ring 0 · failed', 'pi-s-fail', 'pi-hot'],
      ['Ring 1 · in progress', 'pi-s-run', ''],
      ['Ring 2 · waiting for approval', 'pi-s-wait', 'pi-hot'],
      ['Ring 3 · pending', 'pi-s-pending', ''],
      ['Cleanup · skipped', 'pi-s-skip', ''],
    ]);
  });

  it('counts the runs whose stages could not be read', async () => {
    const runs = [run(1), run(30, { stages: null }), run(60, { stages: null })];
    panel(pipeline({}, { runs }), { loadStages: () => Promise.reject(new Error('denied')) });
    await waitFor(() => expect(dialog().getByText('Stages could not be read for 2 runs.')).toBeTruthy());
  });
});
