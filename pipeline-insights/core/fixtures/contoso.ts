/**
 * The synthetic estate the golden tests, the ui tests and the dev page run on: a made-up
 * `contoso` organization whose `Platform` project holds 33 pipelines across six repos. It is
 * written by hand rather than recorded, so it can be committed anywhere, and it is built to hold
 * every case the rules and the page have to get right:
 *
 *   - release lines joined by pipeline-completion triggers (build → deploy), and lines joined by
 *     a shared name and a CI path folder (ci, job-build);
 *   - suggestions, where only one signal links two pipelines;
 *   - a deploy whose latest run failed at a stage, and a pipeline failing on main while its newer
 *     runs are on other branches;
 *   - runs waiting at approvals, one of them stale, two stage groups on one pipeline;
 *   - an unreliable pipeline in the 7-day window only, and another in the 30-day window only;
 *   - idle pipelines with and without triggers, one that has only run on a branch;
 *   - CI, PR (branch policy), schedule, pipeline-completion and other-repo triggers, and
 *     manual-only pipelines;
 *   - drafted descriptions marked (TODO: verify), a purpose read from the YAML's opening comment,
 *     structural summaries, a repo with no metadata file;
 *   - repos that can no longer be read, and a disabled pipeline with a schedule set in its settings.
 *
 *   npm run fixture -w @pipeline-insights/core     # rewrites contoso.json from this file
 *
 * A test checks that contoso.json is what this file builds, so edit here, never the JSON.
 */
import { createHash } from 'node:crypto';
import type { BuildPolicy, Definition, FileEntry, Fixture, Run, Timeline, TimelineRecord } from '../src/index.js';

export const CAPTURED_AT = '2026-10-03T18:30:00.000Z';
const ORG = 'https://dev.azure.com/contoso';
const PROJECT = 'Platform';
const NOW = Date.parse(CAPTURED_AT);
const DAY = 864e5;
const MINUTE = 6e4;

const repo = (n: number, name: string) => ({ id: `00000000-0000-4000-8000-00000000a00${n}`, name });
const APPS = repo(1, 'Orders.Apps');
const DEPLOY = repo(2, 'Orders.Deployment');
const API = repo(3, 'Orders.Api');
const TOOLS = repo(4, 'Orders.Tools');
/** Deleted repos: their pipelines' YAML cannot be read. */
const LEGACY = repo(5, 'Orders.Legacy');
const REPORTS = repo(6, 'Orders.Reports');
const READABLE = [APPS, DEPLOY, API, TOOLS];

type Repo = typeof APPS;

/** One run: queued `age` days before the capture. */
interface RunSpec {
  age: number;
  result?: 'succeeded' | 'failed' | 'canceled' | 'partiallySucceeded';
  /** Unfinished. Give `stages` to say where it is. */
  inProgress?: boolean;
  branch?: string;
  /** Overrides the pipeline's stages for this run's timeline. */
  stages?: StageSpec[];
  /** For a failed run without `stages`: the stage that failed. Defaults to the last. */
  failedAt?: string;
}

interface StageSpec {
  name: string;
  result?: string | null;
  state?: 'completed' | 'inProgress' | 'pending';
  /** An open approval hangs off this stage. */
  waiting?: boolean;
}

interface PipelineSpec {
  id: number;
  name: string;
  folder: string;
  repo: Repo;
  /** As the definition writes it: some with a leading `/`, some without. */
  yaml: string;
  /** The YAML's text; absent for a repo that cannot be read. */
  text?: string;
  disabled?: boolean;
  /** Triggers set in the pipeline settings, beside the stub every YAML pipeline carries. */
  settingsTriggers?: unknown[];
  stages: string[];
  /** Typical run length in minutes. */
  minutes: number;
  reason?: string;
  runs: RunSpec[];
  /** The drafted purpose in its repo's metadata file. */
  purpose?: string;
}

// ── YAML ─────────────────────────────────────────────────────────────────────

const list = (items: string[], indent: string) => items.map((i) => `${indent}- ${i}`).join('\n');

const steps = (stages: string[]) =>
  `stages:\n${stages
    .map((s) => `  - stage: ${s.replace(/[^A-Za-z0-9]+/g, '_')}\n    displayName: '${s}'\n    jobs:\n      - job: run\n        steps:\n          - script: ./run.sh`)
    .join('\n')}\n`;

/** A CI trigger on main with path includes. */
const ci = (paths: string[], stages: string[], extra = '') =>
  `trigger:\n  branches:\n    include:\n      - main\n  paths:\n    include:\n${list(paths, '      ')}\n${extra}pool:\n  vmImage: ubuntu-latest\n${steps(stages)}`;

/** Started by another pipeline finishing on main. */
const after = (source: string, stages: string[]) =>
  `trigger: none\nresources:\n  pipelines:\n    - pipeline: upstream\n      source: ${source}\n      trigger:\n        branches:\n          include:\n            - main\npool:\n  vmImage: ubuntu-latest\n${steps(stages)}`;

const manual = (stages: string[]) => `trigger: none\npool:\n  vmImage: ubuntu-latest\n${steps(stages)}`;

/** Also started by pushes to the deployment repo's rendered config. */
const deploymentRepo = (folder: string) =>
  `resources:\n  repositories:\n    - repository: deployment\n      type: git\n      name: ${PROJECT}/${DEPLOY.name}\n      trigger:\n        branches:\n          include:\n            - main\n        paths:\n          include:\n            - config/_rendered/${folder}/*\n`;

// ── Runs ─────────────────────────────────────────────────────────────────────

/** The release train: when the app builds and their deploys ran, in days ago. */
const TRAIN = [3.2, 5.4, 6.6, 6.7, 6.9, 7.1, 9.6, 9.9, 10.1, 10.7, 10.9, 11.0, 11.2, 11.8, 14.6];
const train = (overrides: Record<number, Partial<RunSpec>> = {}): RunSpec[] => TRAIN.map((age, i) => ({ age, ...overrides[i] }));

/** `n` runs spread over `days`, every `prEvery`th one from a pull request. */
function busy(n: number, days: number, prEvery = 0, from = 0.01): RunSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    age: +(from + (i * (days - from)) / Math.max(1, n - 1)).toFixed(3),
    ...(prEvery && i % prEvery === 1 ? { branch: `refs/pull/${4200 + n * 3 - i}/merge` } : {}),
  }));
}

const RING = ['Build', 'Ring-1 Staging', 'Ring-2 Production'];
const STOREFRONT = ['Build', 'Ring 1: staging', 'Ring 2: production, region east: schema plan', 'Ring 2: production, region east', 'Ring 2: production'];
const STACKS = [
  'Stack 1 — Identity (What-if)',
  'Stack 1 — Identity (Deploy)',
  'Stack 2 — Monitoring (What-if)',
  'Stack 2 — Monitoring (Deploy)',
  'Stack 3 — Shared network (What-if)',
  'Stack 3 — Shared network (Deploy)',
];
const done = (names: string[], until: number): StageSpec[] => names.slice(0, until).map((name) => ({ name, result: 'succeeded' }));

const STUB = { branchFilters: [], pathFilters: [], settingsSourceType: 2, batchChanges: false, maxConcurrentBuildsPerBranch: 1, triggerType: 'continuousIntegration' };
const draft = (text: string) => `${text} (TODO: verify)`;

// ── The estate, in the order Azure DevOps lists the definitions ──────────────

const PIPELINES: PipelineSpec[] = [
  {
    id: 101, name: 'legacy-export-build-deploy', folder: '\\archive', repo: LEGACY,
    yaml: '/az-pipelines/build-deploy_legacy-export.yaml', stages: ['Build', 'Deploy'], minutes: 6,
    runs: [
      { age: 604.1, branch: 'feature/regx-export' }, { age: 604.2, branch: 'feature/regx-export' }, { age: 604.2, branch: 'feature/regx-export' },
      { age: 702.7 }, { age: 730.0 }, { age: 746.8 },
    ],
  },
  {
    id: 102, name: 'legacy-export-run', folder: '\\archive', repo: LEGACY, disabled: true,
    yaml: 'az-pipelines/run_legacy-export.yaml', stages: ['Run'], minutes: 40, reason: 'schedule',
    settingsTriggers: [
      {
        triggerType: 'schedule', settingsSourceType: 1,
        schedules: [{ branchFilters: ['+refs/heads/main'], timeZoneId: 'Pacific Standard Time', startHours: 9, startMinutes: 0, daysToBuild: 'all' }],
      },
    ],
    runs: [{ age: 547.3 }, { age: 548.3 }, { age: 549.3 }],
  },
  {
    id: 103, name: 'reports-api-build', folder: '\\archive', repo: REPORTS,
    yaml: '/build-docker_reports-api.yaml', stages: [], minutes: 4,
    runs: [{ age: 749.8 }, { age: 749.9, branch: 'fix-docker-build' }, { age: 749.9, branch: 'fix-docker-build' }, { age: 750.3 }, { age: 781.1 }],
  },
  {
    id: 104, name: 'file-import-app-build', folder: '\\services\\production', repo: APPS,
    yaml: '/pipelines/file-import-app-build.yaml', stages: ['Build'], minutes: 1.2,
    text: ci(['src/app-file-import/*', 'src/shared-lib/src/*', 'pipelines/file-import-app-build.yaml'], ['Build']),
    purpose: 'Builds the file import app image and pushes it to the registry.',
    runs: train(),
  },
  {
    id: 105, name: 'pricing-app-build', folder: '\\services\\production', repo: APPS,
    yaml: '/pipelines/pricing-app-build.yaml', stages: ['Build'], minutes: 1.7,
    text: ci(['src/app-pricing/*', 'src/shared-lib/src/*', 'src/models/src/*', 'pipelines/pricing-app-build.yaml'], ['Build']),
    purpose: 'Builds the pricing app image, with the models it loads, and pushes it to the registry.',
    runs: train(),
  },
  {
    id: 106, name: 'orders-unit-tests', folder: '\\testing', repo: APPS,
    yaml: '/pipelines/misc/unit-tests.yaml', stages: ['Lint and test'], minutes: 2.3,
    text: `trigger:\n  - main\n  - develop\npool:\n  vmImage: ubuntu-latest\n${steps(['Lint and test'])}`,
    purpose: 'Lints and unit-tests every package in the apps repo, on pushes and as a pull request check.',
    runs: busy(15, 0.2, 2),
  },
  {
    id: 107, name: 'catalog-sync-etl-build', folder: '\\in-development', repo: APPS,
    yaml: '/pipelines/catalog-sync-etl-build.yaml', stages: ['Build'], minutes: 1,
    text: ci(['src/app-catalog-sync-etl/*', 'src/shared-lib/src/*', 'pipelines/catalog-sync-etl-build.yaml'], ['Build']),
    purpose: 'Builds the catalog sync job image.',
    runs: train(),
  },
  {
    id: 108, name: 'orders-api-build-deploy', folder: '\\services\\production', repo: API,
    yaml: 'pipelines/build-test_orders-api.yaml', stages: ['Build and test', 'Deploy'], minutes: 640,
    text: `trigger:\n  branches:\n    include:\n      - main\n      - dev\n      - release/v1\n  paths:\n    include:\n${list(
      ['src/*', 'pipelines/build-test_orders-api.yaml', 'pipelines/templates/**', 'pipelines/dockerfiles/orders-api.Dockerfile', 'src/Orders.Gateway/**', 'pipelines/dockerfiles/orders-gateway.Dockerfile', 'tools/SchemaEmitter/**', 'api-schema.json'],
      '      ',
    )}\npool:\n  vmImage: ubuntu-latest\n${steps(['Build and test', 'Deploy'])}`,
    purpose: 'Builds, tests and deploys the orders API and its gateway.',
    runs: [{ age: 8.7 }, { age: 49.8 }, { age: 50.1 }],
  },
  {
    id: 109, name: 'admin-app-ci', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/ci_app-admin.yaml', stages: ['Test'], minutes: 2.1,
    text: ci(['src/app-admin/**', 'src/shared-lib/**', 'src/db-tool/**', 'src/uv.lock', 'pipelines/ci_app-admin.yaml'], ['Test']),
    purpose: 'Tests the admin app on pushes to main and as a pull request check.',
    runs: busy(15, 4.6, 3, 0.7),
  },
  {
    id: 110, name: 'config-sync-build', folder: '\\tools', repo: DEPLOY,
    yaml: 'pipelines/config-sync/config-sync.yaml', stages: ['Validate', 'Plan', 'Apply'], minutes: 3,
    text: ci(['config/**'], ['Validate', 'Plan', 'Apply']),
    purpose: 'Renders the configuration and applies it to the configuration stores once approved.',
    runs: [
      ...busy(14, 4.8, 0, 0.02).map((r, i) => ({
        ...r,
        branch: `refs/pull/${4380 - i * 7}/merge`,
        stages: [{ name: 'Validate', result: 'succeeded' }, { name: 'Plan', result: 'succeeded' }, { name: 'Apply', result: 'skipped' }],
      })),
      { age: 4.9, inProgress: true, stages: [...done(['Validate', 'Plan'], 2), { name: 'Apply', state: 'pending', waiting: true }] },
    ],
  },
  {
    id: 111, name: 'vault-secret-scope-create', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/vault_create-secret-scope.yaml', stages: ['Create'], minutes: 1.5, reason: 'manual',
    text: manual(['Create']),
    purpose: 'Creates the secret scope a new warehouse region reads its credentials from.',
    runs: [{ age: 61.7, branch: 'add-region-east-warehouse' }, { age: 61.8, branch: 'add-region-east-warehouse' }, { age: 61.9, branch: 'add-region-east-warehouse' }],
  },
  {
    id: 112, name: 'warehouse-region-east-deploy', folder: '\\services\\production', repo: APPS,
    yaml: '/pipelines/warehouse_deploy-region-east.yaml', stages: ['Validate', 'Deploy'], minutes: 5,
    text: ci(['warehouse/regions/east/**', 'warehouse/common/**', 'pipelines/warehouse_deploy-region-east.yaml', 'pipelines/templates/warehouse-region-deploy.yaml', 'pipelines/templates/warehouse-bundle-stage.yaml'], ['Validate', 'Deploy']),
    purpose: 'Deploys the east region warehouse bundle.',
    runs: [{ age: 39.1 }, { age: 39.2 }, { age: 58.9 }],
  },
  {
    id: 113, name: 'warehouse-region-west-deploy', folder: '\\services\\production', repo: APPS,
    yaml: 'pipelines/warehouse_deploy-region-west.yaml', stages: ['Validate', 'Deploy'], minutes: 4.8,
    text: ci(['warehouse/regions/west/**', 'warehouse/common/**', 'pipelines/warehouse_deploy-region-west.yaml', 'pipelines/templates/warehouse-region-deploy.yaml', 'pipelines/templates/warehouse-bundle-stage.yaml'], ['Validate', 'Deploy']),
    purpose: 'Deploys the west region warehouse bundle.',
    runs: [{ age: 3.2 }, { age: 39.1 }, { age: 39.2 }],
  },
  {
    id: 114, name: 'db-tool-ci', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/ci_db-tool.yaml', stages: ['Test'], minutes: 1.4,
    text: ci(
      ['src/db-tool/**', 'src/uv.lock', 'database/config.yaml', 'database/schema/orders.hcl', 'database/schema/catalog.hcl', 'database/api/api_schema.hcl', 'pipelines/ci_db-tool.yaml'],
      ['Test'],
    ),
    purpose: 'Tests the database tool and checks the schema files on pushes and pull requests.',
    runs: busy(15, 3, 2, 0.02),
  },
  {
    id: 115, name: 'ml-ranker-build-deploy', folder: '\\services\\production', repo: APPS,
    yaml: 'pipelines/build-deploy_ranker.yaml', stages: ['Build', 'Deploy'], minutes: 4.2,
    text: ci(['src/models/deployments/ranker-gpu/*', 'src/models/deployments/ranker-cpu/*', 'pipelines/build-deploy_ranker.yaml'], ['Build', 'Deploy']),
    purpose: 'Builds and deploys the GPU and CPU ranker model endpoints.',
    runs: [{ age: 9.6 }, { age: 51.9 }, { age: 52.0 }],
  },
  {
    id: 116, name: 'db-tool-job-build', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/db-tool-job-build.yaml', stages: ['Build'], minutes: 1.75,
    text: ci(
      ['src/db-tool/*', 'database/*', 'src/pyproject.toml', 'src/uv.lock', 'src/shared-lib/src/reference/*', 'pipelines/dockerfiles/db-tool-job.Dockerfile', 'pipelines/db-tool-job-build.yaml'],
      ['Build'],
      deploymentRepo('db-tool'),
    ),
    purpose: 'Builds the database tool job image that applies schema changes.',
    runs: busy(15, 5.2, 0, 0.1),
  },
  {
    id: 117, name: 'db-tool-job-run', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/db-tool-job-run.yaml', stages: ['Run'], minutes: 7.5, reason: 'manual',
    text: manual(['Run']),
    purpose: 'Runs the database tool job against one environment.',
    runs: [{ age: 0.05 }, { age: 10.1 }, { age: 10.1 }, { age: 10.2 }, { age: 10.2 }],
  },
  {
    id: 118, name: 'price-check-gate-job-build', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/price-check-gate-job-build.yaml', stages: ['Build'], minutes: 2.3,
    text: ci(
      ['src/app-price-check/*', 'src/app-pricing/*', 'src/models/*', 'src/shared-lib/*', 'src/pyproject.toml', 'src/uv.lock', 'pipelines/dockerfiles/price-check-gate-job.Dockerfile', 'pipelines/price-check-gate-job-build.yaml'],
      ['Build'],
    ),
    purpose: 'Builds the price check gate job image.',
    runs: busy(15, 10, 0, 0.7),
  },
  {
    id: 119, name: 'infra-stacks', folder: '\\services\\infrastructure', repo: DEPLOY,
    yaml: 'pipelines/infra-stacks/infra-stacks.yaml', stages: STACKS, minutes: 11.5,
    text: ci(['deployment-stacks/**', 'pipelines/infra-stacks/**', 'config/_rendered/stack-params/**', 'config/images.*.json'], STACKS),
    purpose: 'Runs what-if, then deploys, each infrastructure stack in order, with an approval before each deploy.',
    runs: [
      { age: 0.02, inProgress: true, stages: [...done(STACKS, 5), { name: STACKS[5]!, state: 'pending', waiting: true }] },
      { age: 0.03, result: 'canceled' }, { age: 0.04, result: 'canceled' }, { age: 0.3 },
      { age: 0.7, result: 'canceled' }, { age: 0.75, result: 'canceled' }, { age: 0.8 }, { age: 0.82, result: 'canceled' },
      { age: 0.88, result: 'canceled' }, { age: 0.9, result: 'canceled' }, { age: 0.92 }, { age: 1.0 },
      { age: 1.02, result: 'canceled' }, { age: 1.7 }, { age: 1.72, result: 'partiallySucceeded' },
    ],
  },
  {
    id: 120, name: 'price-check-gate', folder: '\\tools', repo: APPS,
    yaml: '/pipelines/price-check-gate.yaml', stages: ['Check'], minutes: 12, reason: 'manual',
    text: manual(['Check']),
    purpose: 'Scores a candidate pricing model against the current one and fails if it is worse.',
    runs: [
      { age: 14.7, branch: 'gate-after-pricing' }, { age: 14.8, branch: 'gate-after-pricing' }, { age: 14.8, branch: 'gate-after-pricing' },
      { age: 14.9, branch: 'gate-after-pricing' }, { age: 38.0 }, { age: 38.1 }, { age: 38.7 },
    ],
  },
  {
    id: 121, name: 'model-retrain-run', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/model-retrain-run.yaml', stages: ['Submit', 'Check'], minutes: 3, reason: 'schedule',
    text: `trigger: none\nschedules:\n${[
      ['0 1 5 1,4,7,10 *', 'Submit'],
      ['0 5 5 1,4,7,10 *', 'Check-4h'],
      ['0 11 5 1,4,7,10 *', 'Check-10h'],
      ['0 1 6 1,4,7,10 *', 'Check-24h'],
    ]
      .map(([cron, name]) => `  - cron: '${cron}'\n    displayName: ${name}\n    branches:\n      include:\n        - main\n    always: true`)
      .join('\n')}\npool:\n  vmImage: ubuntu-latest\n${steps(['Submit', 'Check'])}`,
    purpose: 'Retrains the pricing model each quarter and checks on the job until it finishes.',
    runs: [
      { age: 16.4, branch: 'retrain-tuning' }, { age: 16.6, result: 'failed', branch: 'retrain-tuning' },
      { age: 17.1, result: 'failed', branch: 'retrain-tuning' }, { age: 17.2, result: 'failed', branch: 'retrain-tuning' },
      { age: 17.2, result: 'failed', branch: 'fix-retrain-run' }, { age: 17.3, result: 'failed', branch: 'fix-retrain-run' },
      { age: 17.3, result: 'failed', branch: 'fix-retrain-run' }, { age: 17.5, result: 'failed', branch: 'retrain-tuning' },
      { age: 26.2, result: 'failed' },
    ],
  },
  {
    id: 122, name: 'pricing-app-deploy', folder: '\\services\\production', repo: APPS,
    yaml: '/pipelines/pricing-app-deploy.yaml', stages: RING, minutes: 1400, reason: 'buildCompletion',
    text: after('\\services\\production\\pricing-app-build', RING),
    purpose: 'Deploys each new pricing app build to staging, then to production after approval.',
    runs: train({ 5: { result: 'canceled' }, 6: { result: 'failed', failedAt: 'Ring-1 Staging' } }),
  },
  {
    id: 123, name: 'file-import-app-deploy', folder: '\\services\\production', repo: APPS,
    yaml: '/pipelines/file-import-app-deploy.yaml', stages: RING, minutes: 1380, reason: 'buildCompletion',
    text: after('\\services\\production\\file-import-app-build', RING),
    purpose: 'Deploys each new file import app build to staging, then to production after approval.',
    runs: train({ 3: { result: 'failed', failedAt: 'Ring-1 Staging' }, 4: { result: 'failed', failedAt: 'Ring-1 Staging' } }),
  },
  {
    id: 124, name: 'catalog-sync-etl-deploy', folder: '\\in-development', repo: APPS,
    yaml: '/pipelines/catalog-sync-etl-deploy.yaml', stages: RING, minutes: 1390, reason: 'buildCompletion',
    text: after('\\in-development\\catalog-sync-etl-build', RING),
    purpose: 'Deploys each new catalog sync job build to staging, then to production after approval.',
    runs: train({ 0: { result: 'failed', failedAt: 'Ring-2 Production' } }),
  },
  {
    id: 125, name: 'tools-proxy-build', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/tools-proxy-build.yaml', stages: ['Build'], minutes: 1.5,
    text: ci(['src/tools-proxy/*', 'pipelines/dockerfiles/tools-proxy.Dockerfile', 'pipelines/tools-proxy-build.yaml'], ['Build']),
    purpose: 'Builds the tools proxy image.',
    runs: [
      ...busy(8, 4.9, 0, 0.8),
      { age: 10.05 }, { age: 10.1, branch: 'fix-image-smoke-test' }, { age: 10.12, result: 'failed' }, { age: 10.15, result: 'failed' },
    ],
  },
  {
    id: 126, name: 'smoke-environment', folder: '\\services\\infrastructure', repo: DEPLOY,
    yaml: 'pipelines/smoke-environment/smoke-environment.yaml', stages: ['Deploy', 'Test', 'Tear down'], minutes: 18, reason: 'manual',
    text: manual(['Deploy', 'Test', 'Tear down']),
    purpose: 'Deploys a throwaway workload end to end, tests it, and tears it down.',
    runs: [{ age: 8.7 }, { age: 8.8 }, { age: 9.0, result: 'failed', failedAt: 'Test' }],
  },
  {
    id: 127, name: 'webapp-storefront-ci', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-storefront-ci.yaml', stages: ['Test'], minutes: 2.7,
    text: ci(['src/webapp-storefront/**', 'src/shared-web/**', 'src/shared-lib/**', 'src/uv.lock', 'pipelines/webapp-storefront-ci.yaml'], ['Test']),
    purpose: 'Tests the storefront web app on pushes to main and as a pull request check.',
    runs: busy(15, 0.3, 2, 0.01),
  },
  {
    id: 128, name: 'webapp-storefront-build', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-storefront-build.yaml', stages: ['Build'], minutes: 2,
    text: ci(
      [
        'src/webapp-storefront/*', 'src/shared-web/*', 'src/shared-lib/*', 'database/config.yaml', 'database/schema/catalog.hcl',
        'src/pyproject.toml', 'src/uv.lock', 'pipelines/dockerfiles/webapp-storefront.Dockerfile', 'pipelines/dockerfiles/webapp-storefront.Dockerfile.dockerignore',
        'pipelines/webapp-storefront-build.yaml',
      ],
      ['Build'],
      deploymentRepo('db-tool'),
    ),
    purpose: 'Builds the storefront web app image.',
    runs: busy(15, 1.9, 0, 0.01),
  },
  {
    id: 129, name: 'webapp-storefront-deploy', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-storefront-deploy.yaml', stages: STOREFRONT, minutes: 9, reason: 'buildCompletion',
    text: after('\\tools\\webapp-storefront-build', STOREFRONT),
    purpose: 'Deploys each new storefront build to staging, then region by region to production after approval.',
    runs: [
      { age: 0.01, inProgress: true, stages: [...done(STOREFRONT, 4), { name: STOREFRONT[4]!, state: 'pending', waiting: true }] },
      {
        age: 0.03, inProgress: true,
        stages: [...done(STOREFRONT, 2), { name: STOREFRONT[2]!, result: 'failed' }, { name: STOREFRONT[3]!, result: 'skipped' }, { name: STOREFRONT[4]!, state: 'pending', waiting: true }],
      },
      { age: 0.04 }, { age: 0.1 }, { age: 0.12, result: 'failed', failedAt: STOREFRONT[2]! },
      { age: 0.2, inProgress: true, stages: [...done(STOREFRONT, 3), { name: STOREFRONT[3]!, state: 'pending', waiting: true }, { name: STOREFRONT[4]!, state: 'pending' }] },
      { age: 0.3 },
      { age: 0.7, inProgress: true, stages: [...done(STOREFRONT, 4), { name: STOREFRONT[4]!, state: 'pending', waiting: true }] },
      { age: 0.8 }, { age: 0.81, result: 'failed', failedAt: STOREFRONT[2]! }, { age: 0.85 }, { age: 0.86, result: 'canceled' },
      { age: 1.7 }, { age: 1.72 }, { age: 1.8, result: 'canceled' },
    ],
  },
  {
    id: 130, name: 'webapp-admin-build', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-admin-build.yaml', stages: ['Build'], minutes: 2.05,
    text: ci(
      [
        'src/webapp-admin/*', 'src/shared-web/*', 'src/shared-lib/*', 'database/config.yaml', 'src/pyproject.toml', 'src/uv.lock',
        'pipelines/dockerfiles/webapp-admin.Dockerfile', 'pipelines/dockerfiles/webapp-admin.Dockerfile.dockerignore', 'pipelines/webapp-admin-build.yaml',
      ],
      ['Build'],
      deploymentRepo('db-tool'),
    ),
    purpose: 'Builds the admin web app image.',
    runs: [...busy(9, 1.9, 0, 0.01), ...[2.0, 2.1, 2.1, 2.3].map((age) => ({ age, branch: 'feature/admin-refresh' }))],
  },
  {
    id: 131, name: 'webapp-admin-ci', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-admin-ci.yaml', stages: ['Test'], minutes: 1.9,
    text: ci(['src/webapp-admin/**', 'src/shared-web/**', 'src/shared-lib/**', 'src/uv.lock', 'pipelines/webapp-admin-ci.yaml'], ['Test']),
    purpose: 'Tests the admin web app on pushes to main.',
    runs: busy(9, 1.9, 0, 0.01),
  },
  {
    id: 132, name: 'webapp-admin-deploy', folder: '\\tools', repo: APPS,
    yaml: 'pipelines/webapp-admin-deploy.yaml', stages: ['Ring 1: staging', 'Ring 2: production'], minutes: 1.7, reason: 'buildCompletion',
    text: after('\\tools\\webapp-admin-build', ['Ring 1: staging', 'Ring 2: production']),
    purpose: 'Deploys each new admin web app build to staging, then to production.',
    runs: busy(9, 1.9, 0, 0.01),
  },
  {
    id: 133, name: 'devtools-ci', folder: '\\tools', repo: TOOLS,
    yaml: 'pipelines/ci.yaml', stages: ['__default'], minutes: 1,
    text: `# Installs, typechecks, tests and builds the developer tools on every push to main.\n#\n# It never publishes anything.\n\ntrigger:\n  branches:\n    include:\n      - main\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: npm ci && npm test\n`,
    runs: [{ age: 0.01 }, { age: 0.02 }, { age: 0.03 }],
  },
];

/** Build-validation policies: the PR triggers of the pipelines that check pull requests. */
const POLICIES: [number, string, string[]][] = [
  [106, 'Lint and test', []],
  [109, 'Admin app CI', ['/src/app-admin/*', '/src/shared-lib/*', '/src/uv.lock', '/pipelines/ci_app-admin.yaml']],
  [114, 'DB tool CI', ['/src/db-tool/*', '/database/*', '/pipelines/ci_db-tool.yaml']],
  [110, 'config-sync-build', ['/config/*']],
  [127, 'Storefront CI', ['/src/webapp-storefront/*', '/src/shared-web/*', '/src/shared-lib/*', '/src/uv.lock', '/pipelines/webapp-storefront-ci.yaml']],
];

// ── Assembly ─────────────────────────────────────────────────────────────────

/** A small deterministic PRNG, so run lengths vary but every build of the fixture is the same. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
/** The git object id of a blob with this text, as Azure DevOps lists it. */
const blobId = (text: string) => {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
};
const iso = (ms: number) => new Date(ms).toISOString();

let guid = 0;
const nextGuid = () => `00000000-0000-4000-8000-${(++guid).toString(16).padStart(12, '0')}`;

function timelineFor(stages: StageSpec[]): Timeline {
  const records: TimelineRecord[] = [];
  stages.forEach((s, i) => {
    const id = nextGuid();
    const state = s.state ?? (s.result === undefined ? 'pending' : 'completed');
    records.push({ id, parentId: null, type: 'Stage', name: s.name, state, result: s.result ?? null, order: i + 1 });
    const phase = nextGuid();
    records.push({ id: phase, parentId: id, type: 'Phase', name: 'run', state, result: s.result ?? null, order: 1 });
    if (s.waiting) {
      const checkpoint = nextGuid();
      records.push({ id: checkpoint, parentId: id, type: 'Checkpoint', name: 'Checkpoint', state: 'inProgress', result: null, order: null });
      records.push({ id: nextGuid(), parentId: checkpoint, type: 'Checkpoint.Approval', name: 'Checkpoint.Approval', state: 'inProgress', result: null, order: null });
    }
  });
  return { records };
}

/** The stages of a finished run, from its result. */
function finishedStages(p: PipelineSpec, r: RunSpec): StageSpec[] {
  const result = r.result ?? 'succeeded';
  const last = p.stages.length - 1;
  const failedAt = result === 'failed' ? Math.max(0, p.stages.indexOf(r.failedAt ?? p.stages[last]!)) : -1;
  return p.stages.map((name, i) => {
    if (result === 'failed') return { name, result: i < failedAt ? 'succeeded' : i === failedAt ? 'failed' : 'skipped' };
    if (i < last) return { name, result: 'succeeded' };
    return { name, result: { succeeded: 'succeeded', canceled: 'canceled', partiallySucceeded: 'succeededWithIssues' }[result] ?? 'succeeded' };
  });
}

export function buildFixture(): Fixture {
  guid = 0;
  const definitions: Definition[] = PIPELINES.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.folder,
    queueStatus: p.disabled ? 'disabled' : 'enabled',
    triggers: [STUB, ...(p.settingsTriggers ?? [])],
    process: { type: 2, yamlFilename: p.yaml },
    repository: { id: p.repo.id, name: p.repo.name, type: 'TfsGit', defaultBranch: 'refs/heads/main' },
  }));

  // Every run, then ids in queue order, as Azure DevOps hands them out.
  type Draft = { p: PipelineSpec; r: RunSpec; queued: number; minutes: number; newest: boolean };
  const drafts: Draft[] = [];
  for (const p of PIPELINES) {
    const rand = random(p.id);
    const sorted = [...p.runs].sort((a, b) => a.age - b.age);
    sorted.forEach((r, i) => {
      const queued = Math.round(NOW - r.age * DAY - rand() * 30 * MINUTE);
      drafts.push({ p, r, queued, minutes: p.minutes * (0.85 + rand() * 0.3), newest: i === 0 });
    });
  }
  drafts.sort((a, b) => a.queued - b.queued || a.p.id - b.p.id);

  const runs: Run[] = [];
  const timelines: Record<string, Timeline> = {};
  const perDay = new Map<string, number>();
  drafts.forEach((d, i) => {
    const id = 20001 + i;
    const day = iso(d.queued).slice(0, 10).replace(/-/g, '');
    const n = (perDay.get(`${d.p.id}:${day}`) ?? 0) + 1;
    perDay.set(`${d.p.id}:${day}`, n);
    const branch = d.r.branch ?? 'main';
    const started = d.queued + 4000 + (id % 7) * 1000;
    const run: Run = {
      id,
      buildNumber: `${day}.${n}`,
      status: d.r.inProgress ? 'inProgress' : 'completed',
      reason: branch.startsWith('refs/pull/') ? 'pullRequest' : (d.p.reason ?? 'individualCI'),
      sourceBranch: branch.startsWith('refs/') ? branch : `refs/heads/${branch}`,
      sourceVersion: sha1(`${d.p.name}:${id}`),
      queueTime: iso(d.queued),
      startTime: iso(Math.min(started, NOW - 1000)),
      definition: { id: d.p.id },
    };
    if (!d.r.inProgress) {
      run.result = d.r.result ?? 'succeeded';
      run.finishTime = iso(Math.min(started + d.minutes * MINUTE, NOW - 500));
    }
    runs.push(run);
    // A timeline for each pipeline's newest run and every unfinished one: what a load reads.
    if ((d.newest || d.r.inProgress) && d.p.stages.length) {
      timelines[id] = timelineFor(d.r.stages ?? finishedStages(d.p, d.r));
    }
  });
  runs.reverse();

  return {
    format: 1,
    capturedAt: CAPTURED_AT,
    org: ORG,
    project: PROJECT,
    definitions,
    runs,
    timelines,
    buildValidationPolicies: POLICIES.map(([definitionId, displayName, filenamePatterns], i) => ({
      id: 9001 + i,
      isEnabled: true,
      isBlocking: true,
      isDeleted: false,
      settings: {
        buildDefinitionId: definitionId,
        displayName,
        ...(filenamePatterns.length ? { filenamePatterns } : {}),
        scope: [{ repositoryId: PIPELINES.find((p) => p.id === definitionId)!.repo.id, refName: 'refs/heads/main', matchKind: 'Exact' }],
      },
    })) satisfies BuildPolicy[],
    files: files(),
  };
}

/** Each readable repo's pipeline folders, the YAML in them and its metadata file. */
function files(): NonNullable<Fixture['files']> {
  const listings: Record<string, FileEntry[]> = {};
  const blobs: Record<string, string> = {};
  const add = (r: Repo, folder: string, entry: FileEntry) => (listings[`${r.id}:main:${folder}`] ??= [{ path: `/${folder}`, objectId: sha1(`${r.id}:${folder}`), gitObjectType: 'tree' }]).push(entry);
  const file = (r: Repo, path: string, text: string) => {
    const objectId = blobId(text);
    blobs[objectId] = text;
    add(r, path.slice(0, path.lastIndexOf('/')), { path: `/${path}`, objectId, gitObjectType: 'blob' });
  };
  const tree = (r: Repo, path: string) => add(r, path.slice(0, path.lastIndexOf('/')), { path: `/${path}`, objectId: sha1(`${r.id}:${path}`), gitObjectType: 'tree' });

  for (const r of READABLE) {
    const own = PIPELINES.filter((p) => p.repo === r && p.text);
    for (const p of own) file(r, p.yaml.replace(/^\/+/, ''), p.text!);
    const described = own.filter((p) => p.purpose);
    if (described.length) {
      const entries = described
        .map((p) => `  ${p.yaml.replace(/^\/+/, '')}:\n    purpose: >-\n      ${draft(p.purpose!)}`)
        .join('\n');
      file(r, 'pipelines/pipelines.meta.yaml', `# What each pipeline in ${r.name} is for. Pipeline Insights reads this file.\npipelines:\n${entries}\n`);
    }
    // Subfolders show up in their parent's listing.
    for (const folder of new Set(own.map((p) => p.yaml.replace(/^\/+/, '').split('/').slice(0, -1).join('/')))) {
      if (folder.includes('/')) tree(r, folder);
    }
  }
  tree(APPS, 'pipelines/templates');
  tree(APPS, 'pipelines/dockerfiles');

  const sortedListings = Object.fromEntries(
    Object.entries(listings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...new Map(v.map((e) => [e.path, e])).values()].sort((a, b) => a.path.localeCompare(b.path))]),
  );
  return { listings: sortedListings, blobs: Object.fromEntries(Object.entries(blobs).sort(([a], [b]) => a.localeCompare(b))) };
}

/** The file as `npm run fixture` writes it. */
export const fixtureText = () => `${JSON.stringify(buildFixture(), null, 1)}\n`;
