/**
 * Working out which build the tab is attached to.
 *
 * Split out of `ado.ts` for the same reason `attachmentRefs` was: everything
 * here is pure logic over what the host hands us, and keeping it beside the
 * `azure-devops-extension-sdk` import made it untestable in the `node`
 * environment — the SDK touches `window` when it is imported, so a test of this
 * logic would have had to boot jsdom to reach code that never uses a DOM.
 *
 * That mattered. The bug this file now guards against shipped precisely because
 * the logic was awkward to test, not because it was hard to test.
 */

interface BuildContext {
  projectId: string;
  buildId: number;
  buildNumber?: string | undefined;
}

/** `CommonServiceIds.ProjectPageService`, inlined for the same reason the
 *  navigation service id is: it is an ambient `const enum` with no runtime
 *  object, and `isolatedModules` forbids inlining it from the import. */
const PROJECT_PAGE_SERVICE_ID = 'ms.vss-tfs-web.tfs-page-data-service';

/**
 * How long to wait for the host to hand over a build before giving up.
 *
 * `onBuildChanged` fires when the host has the build, which is normally
 * immediate but is not synchronous. Without a bound, a host that never calls
 * back leaves the tab spinning with no error — the failure mode this whole file
 * is trying to avoid.
 */
const BUILD_HANDOVER_TIMEOUT_MS = 15_000;

/**
 * The build-results tab receives its build through SDK configuration. Shapes
 * differ between host versions, so read defensively and fail with a message
 * rather than a stack trace.
 *
 * This reads the *static* shapes. The live host does not use one — see
 * `resolveBuildContext`.
 */
function readBuildContext(config: Record<string, unknown>): BuildContext | undefined {
  const build = config['build'] as { id?: unknown; buildNumber?: unknown; project?: unknown } | undefined;
  const project = (build?.project ?? config['project']) as { id?: unknown } | undefined;
  const buildId = typeof build?.id === 'number' ? build.id : Number(build?.id);
  const projectId = typeof project?.id === 'string' ? project.id : undefined;
  if (!projectId || !Number.isFinite(buildId)) return undefined;
  return {
    projectId,
    buildId,
    ...(typeof build?.buildNumber === 'string' ? { buildNumber: build.buildNumber } : {}),
  };
}

/**
 * Get the build the tab is attached to, whatever the host offers.
 *
 * **The live host hands the build over through a callback, not a property.**
 * A `ms.vss-build-web.build-results-tab` contribution receives
 * `onBuildChanged(handler)` on its configuration, and the handler is invoked
 * once the host has resolved the build. Reading `config.build` — which is what
 * this file did originally — finds nothing, and the tab renders "could not read
 * the build it is attached to" on a page that is very obviously a build.
 *
 * Verified against a real installed extension on 2026-08-26. No fixture could
 * have caught it: the configuration object only exists inside an extension host.
 *
 * The static shapes are still tried first. They cost nothing, they are what
 * older hosts provided, and a host that supplies the build directly should not
 * be made to wait for a callback.
 */
export async function resolveBuildContext(
  config: Record<string, unknown>,
  getService: (id: string) => Promise<unknown>,
): Promise<BuildContext | undefined> {
  const direct = readBuildContext(config);
  if (direct) return direct;

  const onBuildChanged = config['onBuildChanged'];
  if (typeof onBuildChanged !== 'function') return undefined;

  const build = await new Promise<Record<string, unknown> | undefined>((resolve) => {
    let settled = false;
    const finish = (value: Record<string, unknown> | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // The host may call this more than once — a build that is still running is
    // handed over again as it changes. The first one carries the ids, which is
    // all this tab needs.
    (onBuildChanged as (cb: (b: unknown) => void) => void)((b: unknown) => {
      finish(b as Record<string, unknown>);
    });
    setTimeout(() => {
      finish(undefined);
    }, BUILD_HANDOVER_TIMEOUT_MS);
  });
  if (!build) return undefined;

  const buildId = typeof build['id'] === 'number' ? build['id'] : Number(build['id']);
  if (!Number.isFinite(buildId)) return undefined;

  // The build usually carries its project. When it does not, ask the host —
  // the tab is by definition rendering inside a project.
  const buildProject = build['project'] as { id?: unknown } | undefined;
  let projectId = typeof buildProject?.id === 'string' ? buildProject.id : undefined;
  if (!projectId) {
    try {
      const svc = (await getService(PROJECT_PAGE_SERVICE_ID)) as
        | { getProject?: () => Promise<{ id?: unknown } | undefined> }
        | undefined;
      const project = await svc?.getProject?.();
      if (typeof project?.id === 'string') projectId = project.id;
    } catch {
      // Falls through to the diagnostic error below, which is more useful than
      // this exception would be.
    }
  }
  if (!projectId) return undefined;

  return {
    projectId,
    buildId,
    ...(typeof build['buildNumber'] === 'string' ? { buildNumber: build['buildNumber'] } : {}),
  };
}

/**
 * Say what the host actually provided.
 *
 * "This tab could not read the build it is attached to" is true and useless: it
 * names no cause and suggests no next step, and diagnosing it cost a publish
 * cycle. Listing the configuration's own keys turns the next such failure into
 * a glance — and costs nothing, because these are host-supplied property names,
 * not values.
 */
export function describeConfig(config: Record<string, unknown>): string {
  const keys = Object.keys(config);
  if (keys.length === 0) return 'The host supplied an empty configuration.';
  return `The host supplied: ${keys.sort().join(', ')}.`;
}
