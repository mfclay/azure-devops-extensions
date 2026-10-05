/**
 * Getting a pinned Bicep compiler onto the agent, and running it.
 *
 * **The compiler's stdout is captured, never streamed.** `bicep build-params`
 * writes the *resolved* parameter values to stdout, which for a template with a
 * `@secure()` parameter means the secret itself. Handing that to a logging exec
 * wrapper would publish it to the build log before redaction has anything to
 * work with — the one place redaction cannot reach, because it happens after.
 * That is why this file uses `execFile` directly rather than the task library's
 * logging exec.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  bicepAssetName,
  bicepDownloadUrl,
  bicepFileName,
  normalizeVersion,
  type PlatformInfo,
} from './asset.js';

const execFileAsync = promisify(execFile);

const isBicep = (file: string): boolean => file.toLowerCase().endsWith('.bicep');
const isBicepParam = (file: string): boolean => file.toLowerCase().endsWith('.bicepparam');

/**
 * Loaded on demand rather than at module scope.
 *
 * Importing `azure-pipelines-tool-lib` initializes `azure-pipelines-task-lib`
 * as a side effect, which reads agent variables and writes `##vso[task.debug]`
 * lines. A run that compiles nothing — a pre-compiled ARM template with a JSON
 * parameters file — should not pay for a tool cache it never touches, and a
 * unit test should not have an agent's logging protocol appear in its output.
 */
async function toolLib(): Promise<typeof import('azure-pipelines-tool-lib/tool.js')> {
  return import('azure-pipelines-tool-lib/tool.js');
}

/**
 * Whether a compiler is needed at all.
 *
 * A consumer who has already compiled their template should not download 105 MB
 * to have it read back to them.
 */
export function needsCompiler(
  templateFile: string,
  parametersFile: string | undefined,
): boolean {
  return isBicep(templateFile) || (parametersFile !== undefined && isBicepParam(parametersFile));
}

/** Templates of a few megabytes are ordinary; the default 1 MB buffer is not enough. */
const MAX_BUFFER = 64 * 1024 * 1024;

export class BicepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BicepError';
  }
}

/**
 * Node reports the C library it was built against here. Undefined means musl —
 * Alpine agents, which some self-hosted pools use and which need their own build.
 */
export function detectMusl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report?.getReport();
    if (report !== undefined && typeof report === 'object') {
      const header = (report as Record<string, unknown>)['header'];
      if (header !== null && typeof header === 'object') {
        return !('glibcVersionRuntime' in (header as object));
      }
    }
  } catch {
    // Fall through: assume glibc, which is what every hosted agent uses.
  }
  return false;
}

export function currentPlatform(): PlatformInfo {
  return { platform: process.platform, arch: process.arch, musl: detectMusl() };
}

/**
 * Fetch the pinned compiler, or reuse a cached one.
 *
 * `azure-pipelines-tool-lib` keeps the cache under the agent's tool directory
 * and keys it on name and version, so a second stack in the same run — and every
 * later run on a persistent agent — pays nothing.
 */
export async function ensureBicep(
  version: string,
  log: (message: string) => void,
  info: PlatformInfo = currentPlatform(),
): Promise<string> {
  const pinned = normalizeVersion(version);
  const fileName = bicepFileName(info.platform);

  const tools = await toolLib();
  const cached = tools.findLocalTool('bicep', pinned);
  if (cached) {
    log(`Using cached Bicep ${pinned} from ${cached}.`);
    return path.join(cached, fileName);
  }

  const asset = bicepAssetName(info);
  const url = bicepDownloadUrl(pinned, asset);
  log(`Downloading Bicep ${pinned} (${asset}).`);

  const downloaded = await tools.downloadTool(url);
  const cachedDir = await tools.cacheFile(downloaded, fileName, 'bicep', pinned);
  const binary = path.join(cachedDir, fileName);
  if (info.platform !== 'win32') await fs.chmod(binary, 0o755);

  log(`Bicep ${pinned} cached at ${binary}.`);
  return binary;
}

async function run(binary: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      maxBuffer: MAX_BUFFER,
      // Bicep writes diagnostics to stderr and JSON to stdout; keep them apart.
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    // The message may quote template text. It never quotes parameter *values*,
    // which is why this is safe to surface — but the caller redacts it anyway.
    const stderr =
      error !== null && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : '';
    const message = stderr.trim().length > 0 ? stderr.trim() : String(error);
    throw new BicepError(`bicep ${args[0]} failed:\n${message}`);
  }
}

export interface CompileResult {
  /** The ARM template, as an object. */
  template: unknown;
  /** Whatever the parameters compiled to. `request.ts` unwraps it. */
  parameters: unknown;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BicepError(`${what} did not produce valid JSON: ${String(error)}`);
  }
}

/**
 * Compile the template and its parameters to the JSON ARM wants.
 *
 * A `.bicepparam` is compiled with **one** `build-params` invocation, which
 * returns both halves: `templateJson` carries the declared parameter types and
 * `parametersJson` the resolved values. Taking them from a single call is what
 * makes the redaction sound — the types and the values cannot disagree about
 * which parameter is which, because one compile produced both.
 */
export async function compile(
  binary: string,
  templateFile: string,
  parametersFile: string | undefined,
): Promise<CompileResult> {
  if (parametersFile !== undefined && isBicepParam(parametersFile)) {
    const args = ['build-params', parametersFile, '--stdout'];
    if (isBicep(templateFile)) args.push('--bicep-file', templateFile);
    const compiled = parseJson(await run(binary, args), 'bicep build-params') as Record<
      string,
      unknown
    >;

    const templateJson = compiled['templateJson'];
    const parametersJson = compiled['parametersJson'];
    if (typeof templateJson !== 'string') {
      throw new BicepError(
        `Compiling ${parametersFile} produced no templateJson. A .bicepparam that uses a ` +
          'template spec is not supported here — pass the .bicep template directly.',
      );
    }
    return {
      template: parseJson(templateJson, 'The compiled template'),
      parameters:
        typeof parametersJson === 'string'
          ? parseJson(parametersJson, 'The compiled parameters')
          : {},
    };
  }

  const template = isBicep(templateFile)
    ? parseJson(await run(binary, ['build', templateFile, '--stdout']), 'bicep build')
    : parseJson(await fs.readFile(templateFile, 'utf8'), templateFile);

  const parameters =
    parametersFile !== undefined
      ? parseJson(await fs.readFile(parametersFile, 'utf8'), parametersFile)
      : {};

  return { template, parameters };
}

/** The compiler's own version, for the sidecar. Best effort — never fatal. */
export async function bicepVersion(binary: string): Promise<string | undefined> {
  try {
    const out = await run(binary, ['--version']);
    return /(\d+\.\d+\.\d+)/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

/** A scratch directory for payload, sidecar and summary when none was supplied. */
export async function defaultOutputPath(stackId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `whatif-${stackId}-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
