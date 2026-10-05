#!/usr/bin/env bash
# Register the agent, run it, and unregister on the way out.
#
# The unregistering is the part worth having. Without it every `docker rm`
# leaves a permanently-offline agent in the pool, and after a few iterations you
# cannot tell which entry is the live one.
set -euo pipefail

: "${AZP_URL:?set AZP_URL, e.g. https://dev.azure.com/<org>}"
: "${AZP_TOKEN:?set AZP_TOKEN — a PAT with Agent Pools (Read & manage)}"
AZP_POOL="${AZP_POOL:-Default}"
AZP_AGENT_NAME="${AZP_AGENT_NAME:-$(hostname)-docker}"

cleanup() {
  # Best-effort: a container killed with SIGKILL never reaches this, and the
  # stale agent then has to be removed from the pool by hand.
  if [ -e ./config.sh ]; then
    echo "Unregistering ${AZP_AGENT_NAME}..."
    ./config.sh remove --unattended --auth pat --token "${AZP_TOKEN}" || true
  fi
}
trap 'cleanup; exit 143' SIGTERM
trap 'cleanup; exit 130' SIGINT

echo "Registering ${AZP_AGENT_NAME} into pool '${AZP_POOL}' at ${AZP_URL}"
./config.sh \
  --unattended \
  --acceptTeeEula \
  --url "${AZP_URL}" \
  --auth pat \
  --token "${AZP_TOKEN}" \
  --pool "${AZP_POOL}" \
  --agent "${AZP_AGENT_NAME}" \
  --work "_work" \
  --replace

# `--once` takes a single job and exits, which suits a deliberately temporary
# agent: run it, watch the build, and the container stops on its own. Leave
# AZP_ONCE unset to keep the agent up for repeated runs.
if [ -n "${AZP_ONCE:-}" ]; then
  ./run.sh --once
  cleanup
else
  # `&` plus `wait` rather than exec, so the traps above still fire — with exec
  # the shell is replaced and SIGTERM never reaches cleanup.
  ./run.sh &
  wait $!
fi
