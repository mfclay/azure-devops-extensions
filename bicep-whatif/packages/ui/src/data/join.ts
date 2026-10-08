/**
 * Join build attachments onto build timeline records.
 *
 * This is decision E3 as code. Reconciling against the **timeline** rather than
 * against the attachment list is what makes a stage that produced nothing
 * visible: the timeline knows every `WhatIf_*` stage that the run contains,
 * including the ones that failed with `continueOnError: true` and attached
 * nothing at all.
 *
 * Kept pure — plain objects in, `StageResult[]` out — because the live path
 * cannot be exercised offline and this is the part that has to be right.
 */
import type { Sidecar, StageResult } from '../model/stage.js';
import { WHATIF_STAGE_PREFIX } from './source.js';

/** The subset of `TimelineRecord` this join needs. */
export interface TimelineRecordLike {
  id: string;
  parentId?: string | null | undefined;
  type?: string | undefined;
  /** Human display name, e.g. "Stack 2 — Shared Infrastructure". */
  name?: string | undefined;
  /** YAML stage id, e.g. `WhatIf_SharedInfra`. Present on stage records. */
  identifier?: string | undefined;
  state?: unknown;
  result?: unknown;
}

/** The subset of `Attachment` this join needs. */
export interface AttachmentLike {
  /** Filed as the stack id by the pipeline, e.g. `shared-infra`. */
  name?: string | undefined;
  _links?: { self?: { href?: string | undefined } | undefined } | undefined;
}

export interface AttachmentRef {
  timelineId: string;
  recordId: string;
  type: string;
  name: string;
}

/**
 * Pull the timeline and record ids out of an attachment's self link.
 *
 * The attachment list does not carry them as fields — the only place they exist
 * is the href, shaped
 * `.../build/builds/{buildId}/{timelineId}/{recordId}/attachments/{type}/{name}`.
 * Returns undefined rather than throwing on anything that does not match.
 */
export function parseAttachmentHref(href: string | undefined): AttachmentRef | undefined {
  if (typeof href !== 'string') return undefined;
  const m = /\/builds\/[^/]+\/([^/]+)\/([^/]+)\/attachments\/([^/]+)\/([^/?#]+)/.exec(href);
  if (!m) return undefined;
  const [, timelineId, recordId, type, name] = m;
  if (!timelineId || !recordId || !type || !name) return undefined;
  return {
    timelineId,
    recordId,
    type: decodeURIComponent(type),
    name: decodeURIComponent(name),
  };
}

/**
 * Turn an attachment list into refs, collecting a note for each entry whose link
 * could not be read.
 *
 * This lives here rather than in `ado.ts` for the reason `ado.ts` states about
 * itself: everything decidable without the network belongs in the pure module,
 * where it can be tested. Nothing about turning a list into refs needs a host,
 * and the `_links.self.href` shape it depends on is the part of the live
 * response that was longest unverified.
 *
 * An unreadable link is reported rather than thrown on. A stage whose attachment
 * is skipped renders as unevaluated, which is the honest answer — it is not the
 * same as a stage that had nothing to say.
 */
export function attachmentRefs(
  attachments: readonly AttachmentLike[],
  label: string,
): { refs: AttachmentRef[]; notes: string[] } {
  const refs: AttachmentRef[] = [];
  const notes: string[] = [];
  for (const a of attachments) {
    const ref = parseAttachmentHref(a._links?.self?.href);
    if (ref) refs.push(ref);
    else notes.push(`A ${label} attachment ("${a.name ?? 'unnamed'}") had no readable link and was skipped.`);
  }
  return { refs, notes };
}

/**
 * Walk up `parentId` to the enclosing stage record.
 *
 * An attachment is emitted by a task, so its record id is a task record several
 * levels below the stage. Walking the parent chain is a structural join and
 * needs no agreement between a stage id and a stack id — which matters, because
 * those two are maintained by hand in two different YAML files.
 */
export function stageRecordFor(
  recordId: string,
  byId: ReadonlyMap<string, TimelineRecordLike>,
): TimelineRecordLike | undefined {
  const seen = new Set<string>();
  let current = byId.get(recordId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === 'Stage') return current;
    const parentId = current.parentId;
    if (typeof parentId !== 'string' || parentId.length === 0) return undefined;
    current = byId.get(parentId);
  }
  return undefined;
}

/**
 * Fallback for a timeline that carries no `Stage` record type — derive the stage
 * id from a stack id by re-Pascal-casing it. `shared-infra` → `WhatIf_SharedInfra`.
 * The pipelines maintain that correspondence by hand, so this is a guess and is
 * only reached when the structural join has already failed.
 */
export function stageIdFromStackId(stackId: string): string {
  const pascal = stackId
    .split('-')
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  return `WhatIf_${pascal}`;
}

/** Whether a stage record is named as a what-if stage: `WhatIf_` (any case). */
export function isWhatIfStage(record: TimelineRecordLike): boolean {
  if (record.type !== 'Stage') return false;
  const id = record.identifier ?? record.name ?? '';
  return id.toLowerCase().startsWith(WHATIF_STAGE_PREFIX);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export interface JoinInput {
  records: readonly TimelineRecordLike[];
  /** Payload attachments, already fetched and parsed. Keyed by attachment ref. */
  payloads: ReadonlyArray<{ ref: AttachmentRef; payload: unknown; error?: string | undefined }>;
  sidecars: ReadonlyArray<{ ref: AttachmentRef; sidecar: Sidecar }>;
}

/** A stage's attachments, one entry per stack id, in the order they came. */
type StackHit = { payload?: { payload: unknown; error?: string | undefined }; sidecar?: Sidecar };

/**
 * A sidecar from a what-if. The task writes `operation` on every sidecar and
 * files other operations' under other attachment types, so this one should
 * always pass; older producers write no `operation` at all.
 */
function isWhatIfSidecar(sidecar: Sidecar): boolean {
  const operation = sidecar.operation;
  return operation === undefined || operation === null || String(operation).toLowerCase() === 'whatif';
}

/**
 * Every what-if stage in the run becomes at least one `StageResult`, whether or
 * not it attached anything. That is the entire point.
 *
 * A stage is a what-if stage if it is named `WhatIf_*`, or if a what-if
 * attachment traces to it through the timeline. The name is what makes a stage
 * that never ran visible, since a skipped stage leaves nothing to trace; the
 * attachment lets a pipeline name its stages as it likes. A stage that is
 * neither, such as a `create` stage skipped on this build, is not shown.
 *
 * A stage that ran several stacks gives one result per stack, keyed by the
 * stack id each attachment is filed under; a stage that attached nothing gives
 * one result with no stack. Keying by stage alone let the second stack in a
 * stage silently replace the first.
 */
export function joinStages(input: JoinInput): StageResult[] {
  const byId = new Map<string, TimelineRecordLike>();
  for (const r of input.records) byId.set(r.id, r);

  // Stage record id → stack id → what that stack attached there.
  const hitsByStage = new Map<string, Map<string, StackHit>>();
  const hitFor = (stageId: string, stackId: string): StackHit => {
    let stacks = hitsByStage.get(stageId);
    if (!stacks) hitsByStage.set(stageId, (stacks = new Map()));
    let hit = stacks.get(stackId);
    if (!hit) stacks.set(stackId, (hit = {}));
    return hit;
  };

  const unattachedPayloads: { ref: AttachmentRef; payload: unknown; error?: string | undefined }[] = [];
  for (const p of input.payloads) {
    const stage = stageRecordFor(p.ref.recordId, byId);
    if (stage) hitFor(stage.id, p.ref.name).payload = { payload: p.payload, error: p.error };
    else unattachedPayloads.push(p);
  }

  const sidecarByStackId = new Map<string, Sidecar>();
  for (const s of input.sidecars) {
    if (!isWhatIfSidecar(s.sidecar)) continue;
    sidecarByStackId.set(s.ref.name, s.sidecar);
    const stage = stageRecordFor(s.ref.recordId, byId);
    if (stage) hitFor(stage.id, s.ref.name).sidecar = s.sidecar;
  }

  // In timeline order, so a stage named otherwise keeps its place among the rest.
  const stages = input.records.filter(
    (r) => isWhatIfStage(r) || (r.type === 'Stage' && hitsByStage.has(r.id)),
  );

  // Structural join failed for these — fall back to the stage-id naming rule so
  // the payload is still shown, and say so in the notes.
  const byDerivedStageId = new Map<string, TimelineRecordLike>();
  for (const s of stages) byDerivedStageId.set((s.identifier ?? s.name ?? '').toLowerCase(), s);
  const fallbackNotes = new Map<StackHit, string>();
  for (const p of unattachedPayloads) {
    const guess = stageIdFromStackId(p.ref.name).toLowerCase();
    const stage = byDerivedStageId.get(guess);
    if (!stage) continue;
    const hit = hitFor(stage.id, p.ref.name);
    if (hit.payload) continue;
    hit.payload = { payload: p.payload, error: p.error };
    fallbackNotes.set(
      hit,
      `Attachment "${p.ref.name}" could not be traced to this stage through the timeline; ` +
        'matched on the stage-id naming rule instead.',
    );
  }

  const out: StageResult[] = [];
  for (const stage of stages) {
    const stageId = stage.identifier ?? stage.name ?? stage.id;
    const base = {
      stageId,
      displayName: stage.name ?? stageId,
      ...(asString(stage.state) !== undefined ? { state: asString(stage.state) } : {}),
      ...(asString(stage.result) !== undefined ? { result: asString(stage.result) } : {}),
    };

    const stacks = hitsByStage.get(stage.id);
    if (!stacks || stacks.size === 0) {
      out.push({ ...base, notes: [] });
      continue;
    }

    for (const [stackId, hit] of stacks) {
      const sidecar = hit.sidecar ?? (hit.payload ? sidecarByStackId.get(stackId) : undefined);
      const notes: string[] = [];
      const fallback = fallbackNotes.get(hit);
      if (fallback) notes.push(fallback);
      if (hit.payload?.error) notes.push(hit.payload.error);

      out.push({
        ...base,
        stackId,
        ...(hit.payload !== undefined ? { payload: hit.payload.payload } : {}),
        ...(sidecar !== undefined ? { sidecar } : {}),
        notes,
      });
    }
  }

  // Attachments whose stage is not in the timeline at all. Rare, but dropping
  // them would hide real results, so they get a stage row of their own.
  for (const p of unattachedPayloads) {
    const derived = stageIdFromStackId(p.ref.name);
    if (out.some((s) => s.stackId === p.ref.name)) continue;
    const sidecar = sidecarByStackId.get(p.ref.name);
    out.push({
      stageId: derived,
      displayName: p.ref.name,
      stackId: p.ref.name,
      payload: p.payload,
      ...(sidecar !== undefined ? { sidecar } : {}),
      notes: ['No timeline stage matched this attachment; it is shown on its own.'],
    });
  }

  return out;
}
