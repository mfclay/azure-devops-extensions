/**
 * Where stages come from. Two implementations: committed fixtures (`?mock=1`)
 * and the Azure DevOps SDK.
 */
import type { StageResult } from '../model/stage.js';

/**
 * Attachment types, fixed by the pipeline side of this project. The type string
 * is the join key — one `getAttachments(project, buildId, type)` call returns
 * every stage's attachment for a run, and that single call is the aggregation
 * mechanism (decision B2).
 */
export const ATTACHMENT_TYPE_PAYLOAD = 'whatif.stack.json';
export const ATTACHMENT_TYPE_SIDECAR = 'whatif.stack.sidecar';

/** The YAML stage id prefix every what-if stage carries, e.g. `WhatIf_SharedInfra`. */
export const WHATIF_STAGE_PREFIX = 'whatif_';

export interface LoadResult {
  stages: StageResult[];
  /** Human label for the run, shown under the headline. */
  buildLabel: string;
  /** Things the source coped with. Shown, never swallowed. */
  notes: string[];
  /**
   * This build's results page, `…/_build/results?buildId=N`, when the host
   * gave enough to build it. A stage's log link is made from it.
   */
  buildResultsUrl?: string | undefined;
}

export interface WhatIfSource {
  readonly kind: 'mock' | 'ado';
  load(): Promise<LoadResult>;
}
