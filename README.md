# Azure DevOps Extensions

Azure DevOps extensions, one folder each. Every extension is its own npm project, with its
own lockfile, tests, packaging and docs. Start with the extension's README.

| Extension | Folder | What it is |
|---|---|---|
| Bicep What-If for Deployment Stacks | [`bicep-whatif/`](bicep-whatif) | A build-results tab and pipeline task for Azure Deployment Stacks what-if output, filterable and severity-ranked. |
| Pipeline Insights | [`pipeline-insights/`](pipeline-insights) | One page in the Pipelines menu that shows a project's pipelines at a glance: what needs attention, estate health, and every folder's recent runs. |

```bash
task pre-commit   # every extension's checks, plus the repo-wide identifier scan
```

## Releases

Each extension publishes from its own tag, `<extension>-v<MAJOR.MINOR.PATCH>`, for example
`whatif-v0.2.0`. Its workflow in `.github/workflows/` checks the version is free, runs the
whole chain again, and publishes. Tags are `whatif-v*` and `pi-v*`. Either workflow can also be
started by hand from the Actions tab with a version. Pipeline Insights can still publish from a
terminal with `pipeline-insights/tools/publish-dev`.

## License

[MIT](LICENSE).
