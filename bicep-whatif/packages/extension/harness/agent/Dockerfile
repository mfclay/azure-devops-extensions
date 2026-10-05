# A self-hosted Azure Pipelines agent, for running the harness when the
# organisation has no hosted parallelism.
#
# A brand-new organisation gets **zero** Microsoft-hosted parallel jobs, and the
# free grant is a human-reviewed form that takes days. A self-hosted agent needs
# no grant — private projects include one free self-hosted parallel job, which
# is exactly the slot that is missing. See ../README.md, "A brand-new
# organisation has no agent to run this on".
#
# **Built here rather than pulled.** Microsoft publishes no official agent
# image, and the community ones on Docker Hub are unvetted — registering one
# means handing an image you did not build a PAT that can manage agent pools.
# This is Microsoft's documented Dockerfile shape, with Node added.
#
# Why a container rather than the tarball on your laptop: a self-hosted agent
# executes whatever the pipeline says, as whoever started it. In a container
# that is a throwaway root inside a namespace; natively it is your user, with
# your keys and your files. Teardown is also honest — `docker rm` leaves
# nothing, where the native agent leaves a directory and a registration.

FROM ubuntu:24.04

# Bump deliberately: a stale agent still works (the service auto-updates the
# agent binary in place) but a fresh image should start from something current.
ARG AGENT_VERSION=5.277.0
# **Not `vstsagentpackage.azureedge.net`.** That host is dead — Microsoft's agent
# CDN was on Edgio, which shut down, and it now fails DNS resolution outright
# (curl exit 6). A great deal of documentation, Microsoft's included, still
# prints the old URL. This is the host the release notes actually link to;
# verified returning 200 on 2026-08-26.
ARG AGENT_BASE_URL=https://download.agent.dev.azure.com/agent
# Node 20 is the line the shipped task runs on (`Node20_1`) and the floor this
# workspace claims, so the harness runs on the version CI verifies against
# rather than on whatever the base image happens to carry.
ARG NODE_MAJOR=20
# Supplied by BuildKit. Both are real targets: an Apple Silicon machine builds
# arm64 natively, and there is no reason to emulate x64 for this.
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && node --version

WORKDIR /azp

# The agent ships its own dependency installer; using it is more durable than
# pinning apt package names, which change between Ubuntu releases (libicu70 on
# 22.04, libicu74 on 24.04, and so on).
RUN case "${TARGETARCH}" in \
      amd64) AGENT_ARCH=x64 ;; \
      arm64) AGENT_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/agent.tar.gz \
      "${AGENT_BASE_URL}/${AGENT_VERSION}/vsts-agent-linux-${AGENT_ARCH}-${AGENT_VERSION}.tar.gz" \
 && tar -xzf /tmp/agent.tar.gz -C /azp \
 && rm /tmp/agent.tar.gz \
 && ./bin/installdependencies.sh \
 && rm -rf /var/lib/apt/lists/*

# Runs as a non-root user, unlike Microsoft's sample which sets
# AGENT_ALLOW_RUNASROOT=1. The point of using a container here is isolation;
# running as root inside it gives most of that away for no benefit, because
# nothing the harness does needs privilege.
RUN useradd --create-home --shell /bin/bash agent \
 && chown -R agent:agent /azp
USER agent

COPY --chown=agent:agent start.sh /azp/start.sh

ENTRYPOINT ["/azp/start.sh"]
