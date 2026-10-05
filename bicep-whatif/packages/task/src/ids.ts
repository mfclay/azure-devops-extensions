/**
 * Names and resource ids. Pure, because every one of them is a string the
 * service will reject at run time if it is wrong, and a unit test is a much
 * cheaper place to find that out than an agent.
 */

/**
 * Layer number from the template file name: `05-workload-stack.bicep` -> 5.
 *
 * The layer is the deployment ordering the stack files encode in their own
 * names, and the tab groups the stack filter by it. Ported verbatim from
 * `Get-StackLayer` in `Invoke-StackWhatIf.ps1` so a run through this task lands
 * in the same group as a run through the PowerShell.
 */
export function layerFromTemplateFile(templateFile: string): number | undefined {
  const leaf = templateFile.split(/[\\/]/).pop() ?? '';
  const m = /^(\d+)-/.exec(leaf);
  if (!m || m[1] === undefined) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * The what-if result resource name.
 *
 * Stack what-if is not a transient operation — it creates a persistent
 * `Microsoft.Resources/deploymentStacksWhatIfResults` at subscription scope that
 * counts against that scope's resource limits. Scoping the name to the build id
 * is what stops two concurrent PR builds colliding on it. Falls back to a
 * timestamp when there is no build id, which is the local-run case.
 */
export function defaultResultName(stackId: string, buildId: string | undefined, now: Date): string {
  const trimmed = buildId?.trim() ?? '';
  if (trimmed.length > 0) return `whatif-${stackId}-${trimmed}`;

  // `2026-08-25T20:15:30.000Z` -> `20260825-201530`. Taking 14 digits and not
  // 15 matters: the fifteenth is the `.` before the milliseconds, and an Azure
  // resource name may not end in one.
  const digits = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `whatif-${stackId}-${digits.slice(0, 8)}-${digits.slice(8)}`;
}

export function whatIfResultId(subscriptionId: string, resultName: string): string {
  return (
    `/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Resources/deploymentStacksWhatIfResults/${resultName}`
  );
}

/**
 * The stack the what-if compares against. Required by the service and it must be
 * fully qualified — this is what makes the operation *stack* what-if rather than
 * deployment what-if, and it is why detached and deleted resources appear at all.
 */
export function deploymentStackId(subscriptionId: string, stackName: string): string {
  return (
    `/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Resources/deploymentStacks/${stackName}`
  );
}
