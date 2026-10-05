import type { Pipeline } from '@pipeline-insights/core';

/** Where the page's links go. Every action happens in Azure DevOps, so the host says where that is. */
export interface InsightsLinks {
  run(runId: number): string;
  pipeline(pipelineId: number): string;
  yaml(pipeline: Pipeline): string;
  /** Any file in the pipeline's repo, such as its metadata file, by path from the repo root. */
  file(pipeline: Pipeline, path: string): string;
}

/** Links into an Azure DevOps project, such as `adoLinks('https://dev.azure.com/org', 'Project')`. */
export function adoLinks(org: string, project: string): InsightsLinks {
  const base = `${org.replace(/\/+$/, '')}/${encodeURIComponent(project)}`;
  return {
    run: (id) => `${base}/_build/results?buildId=${id}`,
    pipeline: (id) => `${base}/_build?definitionId=${id}`,
    yaml: (p) => `${base}/_git/${encodeURIComponent(p.repo)}?path=/${encodeURIComponent(p.yamlPath)}`,
    file: (p, path) => `${base}/_git/${encodeURIComponent(p.repo)}?path=/${encodeURIComponent(path)}`,
  };
}
