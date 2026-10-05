#!/usr/bin/env node
/**
 * File a committed fixture as a build attachment, exactly as the task would.
 *
 * The tab never checks what produced an attachment. It asks Azure DevOps for
 * every attachment of type `whatif.stack.json` on a build, reads them, and
 * reconciles them against the timeline. So a pipeline that attaches a fixture is
 * indistinguishable, from the tab's side, from one that spent two minutes
 * talking to ARM — which is the whole point of the harness: it exercises the
 * live path (SDK handshake, `getAttachments`, href parsing, timeline join,
 * rendering) with no Azure subscription, no service connection, and no stacks.
 *
 *   node attach-fixture.mjs --stack network --layer 1 \
 *     --payload packages/core/fixtures/real/build-7700017-app-network.json
 *
 *   node attach-fixture.mjs --stack broken --layer 4 --status failed \
 *     --error 'Bicep compilation failed'          # sidecar only, no payload
 *
 * Paths are resolved against the repo root, so pass them as they appear in the
 * repo. Run it from a pipeline step; outside one the logging commands are inert
 * text, which makes it safe to run locally to see what it would emit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');

const ATTACHMENT_TYPE_PAYLOAD = 'whatif.stack.json';
const ATTACHMENT_TYPE_SIDECAR = 'whatif.stack.sidecar';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const stackId = flag('stack');
const payloadRel = flag('payload');
const layer = flag('layer');
const status = flag('status', payloadRel ? 'succeeded' : 'failed');
const error = flag('error', null);

if (!stackId) {
  console.error('usage: attach-fixture.mjs --stack <id> [--payload <path>] [--layer <n>] [--status ...] [--error ...]');
  process.exit(2);
}

// Where the agent lets us write. Falls back to the OS temp dir so the script is
// runnable locally for inspection.
const outDir = process.env['AGENT_TEMPDIRECTORY'] ?? process.env['RUNNER_TEMP'] ?? '/tmp';
mkdirSync(outDir, { recursive: true });

/** `##vso[task.addattachment type=…;name=…;]<path>` — the transport, decision B2. */
function attach(type, name, filePath) {
  console.log(`##vso[task.addattachment type=${type};name=${name};]${filePath}`);
}

if (payloadRel) {
  const payloadPath = path.resolve(repo, payloadRel);
  if (!existsSync(payloadPath)) {
    console.error(`No fixture at ${payloadPath}. Paths are relative to the repo root.`);
    process.exit(1);
  }
  // Parse before attaching. A fixture that is not JSON would surface in the tab
  // as an unreadable attachment, which is a confusing way to learn about a typo.
  try {
    JSON.parse(readFileSync(payloadPath, 'utf8'));
  } catch (e) {
    console.error(`${payloadPath} is not valid JSON: ${String(e)}`);
    process.exit(1);
  }
  attach(ATTACHMENT_TYPE_PAYLOAD, stackId, payloadPath);
}

// The sidecar is written on every path, with or without a payload. That is the
// correctness rule the task exists to uphold — a consumer has to be able to tell
// "evaluated, found nothing" from "never evaluated", and only the sidecar's
// presence distinguishes them.
const sidecar = {
  schemaVersion: 1,
  stackId,
  layer: layer === undefined ? null : Number(layer),
  whatIfResultName: `whatif-${stackId}-${process.env['BUILD_BUILDID'] ?? '0'}`,
  whatIfResultId: null,
  azCliVersion: null,
  status,
  error,
  producer: 'harness',
};

const sidecarPath = path.join(outDir, `${stackId}.sidecar.json`);
writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
attach(ATTACHMENT_TYPE_SIDECAR, stackId, sidecarPath);

console.log(`harness: filed ${stackId}${payloadRel ? '' : ' (sidecar only)'} as ${status}.`);
