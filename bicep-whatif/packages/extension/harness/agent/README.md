# A containerised build agent

For running the harness when the organisation has no hosted parallelism — which
is every new organisation. See [../README.md](../README.md), "A brand-new
organisation has no agent to run this on", for why that happens and what the
alternative is.

## Build it

Docker Desktop has to be running; the CLI being installed is not the same thing.

```bash
docker build -t whatif-harness-agent packages/extension/harness/agent
```

Builds native — arm64 on Apple Silicon, x64 elsewhere — off `TARGETARCH`. There
is no reason to emulate.

## Run it

The PAT needs **Agent Pools (Read & manage)** and is used at registration and
deregistration only. It is a write-capable credential, so keep it out of
`~/.zshenv` and out of anything that exports it ambiently — pass it on this one
command and let it go.

```bash
docker run --rm -it \
  -e AZP_URL=https://dev.azure.com/<org> \
  -e AZP_TOKEN=<pat> \
  -e AZP_POOL=Default \
  whatif-harness-agent
```

Then queue the harness against that pool rather than the hosted image:

```bash
az pipelines run --id <pipeline-id> --project <project> --branch main \
  --parameters pool=Default
```

`pool` is a pipeline parameter precisely so this needs no edit to
`azure-pipelines.yml`. Empty means the hosted `ubuntu-latest` image; a pool name
means your agent.

`AZP_ONCE=1` makes the agent take a single job and exit, which suits a
deliberately temporary agent: run it, watch the build, and the container stops
by itself.

## Tearing it down

`Ctrl-C`, or `docker stop`. The entrypoint traps both and unregisters the agent
on the way out, which matters more than it sounds: without it every run leaves a
permanently-offline agent in the pool, and after a few you cannot tell which
entry is live. A `docker kill` — SIGKILL — skips the trap, and that agent has to
be removed from the pool by hand.

Then delete the image if you are done: `docker rmi whatif-harness-agent`.

## Why this is built and not pulled

Microsoft publishes no official agent image. The community ones on Docker Hub
are unvetted, and registering one means handing an image you did not build a PAT
that can manage agent pools. The `Dockerfile` here is Microsoft's documented
shape with Node added, and it is short enough to read in a minute.

## Why a container rather than the tarball

A self-hosted agent runs whatever the pipeline says, as whoever started it. In a
container that is an unprivileged user inside a namespace; run natively it is
your account, with your SSH keys and your files. For a pipeline whose steps you
wrote, the difference is small — but "temporary" should mean it leaves nothing
behind, and `docker rm` is a stronger guarantee than remembering to run
`config.sh remove`.

It also actually is `ubuntu-latest`, which is what the pipeline claims to want,
so nothing macOS-specific can hide here and then reappear when the hosted grant
lands.
