# Documentation index

| Folder | What is in it |
| --- | --- |
| [phase-0/](./phase-0/) | The Phase 0 audit: [architecture snapshot](./phase-0/01-architecture.md) and [findings, risks and roadmap](./phase-0/02-audit-findings-and-roadmap.md). |
| [ops/](./ops/) | Operating the deployed stack (below). |
| [decisions/](./decisions/) | Decision records: [0001 how StoreCentral carries Medusa](./decisions/0001-medusa-fork-strategy.md) (keep only the dashboard vendored, use published packages for the server).|
| [superpowers/specs/](./superpowers/specs/) | Design documents, one per feature or phase, written before the work starts. |
| [superpowers/plans/](./superpowers/plans/) | Implementation plans that follow each spec, task by task. |

## Operations

| Document | What it covers |
| --- | --- |
| [runbook.md](./ops/runbook.md) | Running the compose stack: first deploy, smoke test, update and rollback, reading health, backups, the restore drill and test databases. |
| [secrets.md](./ops/secrets.md) | Every secret, its owner service, how to generate it and what to do when it is rotated. |
| [memory.md](./ops/memory.md) | Measured memory use per service and how to measure it again. |
| [stock-split.md](./ops/stock-split.md) | Owner-run procedure for the one-time split of existing stock across sales channels. |
| [migration-check.md](./ops/migration-check.md) | Checklist for verifying the channel-offers migration against a scratch database. |
| [upstream-sync.md](./ops/upstream-sync.md) | How to upgrade the vendored dashboard to a new upstream Medusa version (three-way merge procedure).|

There is no testing documentation folder at present.
