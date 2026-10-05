import type { PipelineSource } from '@pipeline-insights/core';
import * as SDK from 'azure-devops-extension-sdk';
import { AdoSource } from './ado-source.js';

/**
 * Where the hub reads pipelines from: the project it is open in.
 *
 * A seam for one purpose. A `--mode demo` build swaps this module for `demo-source.ts`
 * (see vite.config.ts), so the demo extension shows the synthetic estate inside Azure DevOps
 * while every other build never references a fixture.
 */
export function hubSource(collection: string, project: string): PipelineSource {
  return new AdoSource(collection, project, () => SDK.getAccessToken());
}
