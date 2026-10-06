/**
 * Getting a compiler and running it, without downloading 105 MB.
 *
 * The tool cache is stubbed; the compiler is not. Each "bicep" below is a small
 * Node script on disk, so `execFile`, the stdout/stderr split and the exit code
 * are the real ones. That matters for the one rule this file carries: stdout is
 * captured, never streamed, because `build-params` prints resolved secrets.
 */
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collector } from './helpers.js';

const h = vi.hoisted(() => ({
  cached: '' as string,
  downloaded: [] as string[],
  cacheDir: '' as string,
}));

vi.mock('azure-pipelines-tool-lib/tool.js', () => ({
  findLocalTool: (_name: string, _version: string) => h.cached,
  downloadTool: async (url: string) => {
    h.downloaded.push(url);
    return join(h.cacheDir, 'download.tmp');
  },
  cacheFile: async (_source: string, fileName: string) => {
    writeFileSync(join(h.cacheDir, fileName), '');
    return h.cacheDir;
  },
}));

const { BicepError, bicepVersion, compile, currentPlatform, defaultOutputPath, detectMusl, ensureBicep } =
  await import('../src/bicep/tool.js');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bicep-tool-test-'));
  h.cached = '';
  h.downloaded.length = 0;
  h.cacheDir = dir;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A stand-in compiler: a Node script that behaves the way the body says. */
function fakeBicep(body: string): string {
  const file = join(dir, `bicep-${String(Math.random()).slice(2)}`);
  writeFileSync(file, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

const TEMPLATE = { $schema: 'template', resources: [] };
const PARAMS = { $schema: 'parameters', parameters: { location: { value: 'centralus' } } };

describe('ensureBicep', () => {
  const linux = { platform: 'linux', arch: 'x64', musl: false };

  it('reuses a cached compiler without downloading', async () => {
    h.cached = '/agent/tools/bicep/0.46.1/x64';
    const log = collector();
    const binary = await ensureBicep('v0.46.1', log.log, linux);
    expect(binary).toBe('/agent/tools/bicep/0.46.1/x64/bicep');
    expect(h.downloaded).toEqual([]);
    expect(log.text()).toMatch(/Using cached Bicep 0\.46\.1/);
  });

  it('downloads the pinned asset for the platform, caches it, and makes it executable', async () => {
    const log = collector();
    const binary = await ensureBicep('0.46.1', log.log, linux);
    expect(h.downloaded).toEqual(['https://github.com/Azure/bicep/releases/download/v0.46.1/bicep-linux-x64']);
    expect(binary).toBe(join(dir, 'bicep'));
    expect(statSync(binary).mode & 0o777).toBe(0o755);
    expect(log.text()).toMatch(/Downloading Bicep 0\.46\.1 \(bicep-linux-x64\)/);
  });

  it('leaves permissions alone on Windows', async () => {
    const binary = await ensureBicep('0.46.1', () => undefined, { platform: 'win32', arch: 'x64', musl: false });
    expect(binary).toBe(join(dir, 'bicep.exe'));
    expect(h.downloaded[0]).toMatch(/bicep-win-x64\.exe$/);
    expect(statSync(binary).mode & 0o111).toBe(0);
  });

  it('refuses a version that is not pinned', async () => {
    await expect(ensureBicep('latest', () => undefined, linux)).rejects.toThrow(/latest/);
    expect(h.downloaded).toEqual([]);
  });
});

describe('compile', () => {
  it('reads a pre-compiled template and JSON parameters straight off disk', async () => {
    const t = join(dir, 'main.json');
    const p = join(dir, 'main.parameters.json');
    writeFileSync(t, JSON.stringify(TEMPLATE));
    writeFileSync(p, JSON.stringify(PARAMS));
    expect(await compile('/no/compiler/needed', t, p)).toEqual({ template: TEMPLATE, parameters: PARAMS });
  });

  it('defaults parameters to empty when none are given', async () => {
    const t = join(dir, 'main.json');
    writeFileSync(t, JSON.stringify(TEMPLATE));
    expect((await compile('/no/compiler/needed', t, undefined)).parameters).toEqual({});
  });

  it('builds a .bicep template with `bicep build --stdout`', async () => {
    const bicep = fakeBicep(
      `if (args[0] !== 'build' || args[2] !== '--stdout') process.exit(9);\n` +
        `process.stdout.write(JSON.stringify(${JSON.stringify(TEMPLATE)}));`,
    );
    const result = await compile(bicep, join(dir, 'main.bicep'), undefined);
    expect(result).toEqual({ template: TEMPLATE, parameters: {} });
  });

  it('takes both halves of a .bicepparam from one build-params call', async () => {
    const out = join(dir, 'argv.json');
    const bicep = fakeBicep(
      `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(args));\n` +
        `process.stdout.write(JSON.stringify({ templateJson: ${JSON.stringify(JSON.stringify(TEMPLATE))},` +
        ` parametersJson: ${JSON.stringify(JSON.stringify(PARAMS))} }));`,
    );
    const result = await compile(bicep, 'main.bicep', 'main.bicepparam');
    expect(result).toEqual({ template: TEMPLATE, parameters: PARAMS });
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual([
      'build-params',
      'main.bicepparam',
      '--stdout',
      '--bicep-file',
      'main.bicep',
    ]);
  });

  it('lets a .bicepparam name its own template when the template is not Bicep', async () => {
    const out = join(dir, 'argv.json');
    const bicep = fakeBicep(
      `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(args));\n` +
        `process.stdout.write(JSON.stringify({ templateJson: '{}' }));`,
    );
    const result = await compile(bicep, 'main.json', 'main.bicepparam');
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['build-params', 'main.bicepparam', '--stdout']);
    // No parametersJson in the output is an empty parameter set, not an error.
    expect(result.parameters).toEqual({});
  });

  it('refuses a .bicepparam that compiles to no template', async () => {
    const bicep = fakeBicep(`process.stdout.write(JSON.stringify({ parametersJson: '{}' }));`);
    await expect(compile(bicep, 'main.bicep', 'main.bicepparam')).rejects.toThrow(/template spec is not supported/);
  });

  it('surfaces the compiler stderr, not its stdout, when it fails', async () => {
    const bicep = fakeBicep(
      `process.stdout.write('SECRET-RESOLVED-VALUE');\n` +
        `process.stderr.write('main.bicep(3,1) : Error BCP018: Expected a character.\\n');\n` +
        `process.exit(1);`,
    );
    const error = await compile(bicep, 'main.bicep', undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BicepError);
    expect(String((error as Error).message)).toMatch(/^bicep build failed:\nmain\.bicep\(3,1\) : Error BCP018/);
    expect(String((error as Error).message)).not.toMatch(/SECRET/);
  });

  it('falls back to the process error when stderr is empty', async () => {
    const bicep = fakeBicep('process.exit(3);');
    await expect(compile(bicep, 'main.bicep', undefined)).rejects.toThrow(/bicep build failed:\n.*Command failed/);
  });

  it('reports a compiler that cannot be started', async () => {
    await expect(compile(join(dir, 'missing'), 'main.bicep', undefined)).rejects.toThrow(/bicep build failed:\n.*ENOENT/);
  });

  it('reports output that is not JSON, naming what produced it', async () => {
    const bicep = fakeBicep(`process.stdout.write('not json');`);
    await expect(compile(bicep, 'main.bicep', undefined)).rejects.toThrow(/bicep build did not produce valid JSON/);

    const bad = join(dir, 'main.json');
    writeFileSync(bad, '{');
    await expect(compile('/unused', bad, undefined)).rejects.toThrow(`${bad} did not produce valid JSON`);
  });

  it('reports a templateJson that is not JSON', async () => {
    const bicep = fakeBicep(`process.stdout.write(JSON.stringify({ templateJson: '{' }));`);
    await expect(compile(bicep, 'main.bicep', 'main.bicepparam')).rejects.toThrow(
      /The compiled template did not produce valid JSON/,
    );
  });
});

describe('bicepVersion', () => {
  it('reads the version out of the banner', async () => {
    const bicep = fakeBicep(`process.stdout.write('Bicep CLI version 0.46.1 (0123abcd)\\n');`);
    expect(await bicepVersion(bicep)).toBe('0.46.1');
  });

  it('is undefined, never fatal, when there is no version or no compiler', async () => {
    expect(await bicepVersion(fakeBicep(`process.stdout.write('who knows');`))).toBeUndefined();
    expect(await bicepVersion(join(dir, 'missing'))).toBeUndefined();
  });
});

describe('detectMusl', () => {
  function onPlatform(platform: NodeJS.Platform): void {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  }

  it('is false off Linux', () => {
    onPlatform('darwin');
    expect(detectMusl()).toBe(false);
  });

  it('is false on glibc, which reports its runtime version', () => {
    onPlatform('linux');
    vi.spyOn(process.report, 'getReport').mockReturnValue({ header: { glibcVersionRuntime: '2.39' } } as never);
    expect(detectMusl()).toBe(false);
  });

  it('is true on musl, which does not', () => {
    onPlatform('linux');
    vi.spyOn(process.report, 'getReport').mockReturnValue({ header: {} } as never);
    expect(detectMusl()).toBe(true);
  });

  it('assumes glibc when the report is unreadable', () => {
    onPlatform('linux');
    vi.spyOn(process.report, 'getReport').mockImplementation(() => {
      throw new Error('no report');
    });
    expect(detectMusl()).toBe(false);
  });

  it('assumes glibc when the report has no header', () => {
    onPlatform('linux');
    vi.spyOn(process.report, 'getReport').mockReturnValue({} as never);
    expect(detectMusl()).toBe(false);
  });

  it('feeds currentPlatform', () => {
    expect(currentPlatform()).toEqual({ platform: process.platform, arch: process.arch, musl: detectMusl() });
  });
});

describe('defaultOutputPath', () => {
  it('creates a scratch directory named for the stack', async () => {
    const out = await defaultOutputPath('network');
    expect(out).toContain(`whatif-network-${String(process.pid)}`);
    expect(statSync(out).isDirectory()).toBe(true);
  });
});
