# Azure DevOps Extensions

Azure DevOps extensions, one folder each. Every extension is its own npm project, with its
own lockfile, tests, packaging and docs. Start with the extension's README.

| Extension | Folder | What it is |
|---|---|---|
| Bicep What-If for Deployment Stacks | [`bicep-whatif/`](bicep-whatif) | A build-results tab and pipeline task for Azure Deployment Stacks what-if output, filterable and severity-ranked. |
| Pipeline Insights | [`pipeline-insights/`](pipeline-insights) | One page in the Pipelines menu that shows a project's pipelines at a glance: what needs attention, pipeline health, and every folder's recent runs. |

```bash
task pre-commit   # every extension's checks, plus the repo-wide identifier scan
```

## Releases

[RELEASING.md](RELEASING.md) covers how both extensions reach the Marketplace: identity, dev
builds, the release steps, credentials, and the listing's images. It is written to be useful
for anyone building an Azure DevOps extension.

Releases are published from a terminal. Each is tagged `<extension>-v<MAJOR.MINOR.PATCH>`
(`pi-v1.0.1`) once it is live; tags start no workflow. The publish workflows in
`.github/workflows/` publish dev builds only, started by hand from the Actions tab.

## License

[MIT](LICENSE).
