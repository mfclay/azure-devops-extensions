/**
 * The live path: Azure DevOps build attachments, reconciled against the build
 * timeline.
 *
 * Deliberately thin: everything that can be decided without the network lives in
 * `join.ts` and is unit-tested there, and this module is confined to fetching.
 *
 * **What is now verified, and what still is not.** The pipeline side has landed,
 * so a real build's timeline and attachment lists were captured and are replayed
 * through the pure join by `test/joinCapture.test.ts` — see
 * `packages/core/fixtures/real/build-7700078-timeline-and-attachments.json`.
 * That settles the response *shapes* this module depends on: the `getAttachments`
 * list, the `_links.self.href` format `parseAttachmentHref` picks apart, the
 * timeline's `Stage` records and parent chain, and the sidecar body.
 *
 * What no fixture can settle is the host handshake, because it only exists inside
 * a real extension: `SDK.init`/`SDK.ready`, the shape `SDK.getConfiguration()`
 * returns, `getClient(BuildRestClient)`, and `getAttachment` handing back an
 * `ArrayBuffer`. Those remain unexercised until the extension is installed
 * somewhere. `readBuildContext` is written defensively for that reason.
 */
import { getClient } from 'azure-devops-extension-api';
import { BuildRestClient } from 'azure-devops-extension-api/Build';
import * as SDK from 'azure-devops-extension-sdk';
import { ensureSdkReady } from './sdk.js';
import { describeConfig, resolveBuildContext } from './buildContext.js';
import type { Sidecar } from '../model/stage.js';
import {
  attachmentRefs,
  joinStages,
  type AttachmentLike,
  type AttachmentRef,
  type TimelineRecordLike,
} from './join.js';
import {
  ATTACHMENT_TYPE_PAYLOAD,
  ATTACHMENT_TYPE_SIDECAR,
  type LoadResult,
  type WhatIfSource,
} from './source.js';

function decodeAttachment(buffer: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
}

export function createAdoSource(): WhatIfSource {
  return {
    kind: 'ado',
    async load(): Promise<LoadResult> {
      // Shared, memoised, and already done by `main.tsx` before the first
      // render. Calling `init()` a second time here would re-assert
      // `loaded: false` after the host had been told the tab was ready.
      await ensureSdkReady();

      const config = SDK.getConfiguration() as Record<string, unknown>;
      const context = await resolveBuildContext(config, (id) => SDK.getService(id));
      if (!context) {
        throw new Error(
          'This tab could not read the build it is attached to. Open it from a build results page. ' +
            describeConfig(config),
        );
      }

      const client = getClient(BuildRestClient);
      const notes: string[] = [];

      const [timeline, payloadAttachments, sidecarAttachments] = await Promise.all([
        client.getBuildTimeline(context.projectId, context.buildId),
        client.getAttachments(context.projectId, context.buildId, ATTACHMENT_TYPE_PAYLOAD),
        client
          .getAttachments(context.projectId, context.buildId, ATTACHMENT_TYPE_SIDECAR)
          .catch(() => [] as AttachmentLike[]),
      ]);

      const records = (timeline.records ?? []) as unknown as TimelineRecordLike[];

      const payload = attachmentRefs(payloadAttachments as unknown as AttachmentLike[], 'what-if');
      const sidecar = attachmentRefs(sidecarAttachments as unknown as AttachmentLike[], 'sidecar');
      notes.push(...payload.notes, ...sidecar.notes);
      const payloadRefs = payload.refs;
      const sidecarRefs = sidecar.refs;

      const fetchOne = async (ref: AttachmentRef): Promise<{ ref: AttachmentRef; value: unknown } | undefined> => {
        try {
          const buf = await client.getAttachment(
            context.projectId,
            context.buildId,
            ref.timelineId,
            ref.recordId,
            ref.type,
            ref.name,
          );
          return { ref, value: decodeAttachment(buf) };
        } catch (err) {
          // A stage whose attachment cannot be read is not a stage with no
          // changes. Leave it unattached so it renders as unevaluated.
          notes.push(`Attachment "${ref.name}" (${ref.type}) could not be read: ${String(err)}`);
          return undefined;
        }
      };

      const [payloadResults, sidecarResults] = await Promise.all([
        Promise.all(payloadRefs.map(fetchOne)),
        Promise.all(sidecarRefs.map(fetchOne)),
      ]);

      const stages = joinStages({
        records,
        payloads: payloadResults
          .filter((r): r is { ref: AttachmentRef; value: unknown } => r !== undefined)
          .map((r) => ({ ref: r.ref, payload: r.value })),
        sidecars: sidecarResults
          .filter((r): r is { ref: AttachmentRef; value: unknown } => r !== undefined)
          .map((r) => ({ ref: r.ref, sidecar: r.value as Sidecar })),
      });

      if (stages.length === 0) {
        notes.push(
          'No WhatIf_* stages were found in this build timeline. This tab shows results ' +
            'for builds that run the stack what-if stages.',
        );
      }

      return {
        stages,
        buildLabel: context.buildNumber ? `build ${context.buildNumber}` : `build ${String(context.buildId)}`,
        notes,
      };
    },
  };
}
