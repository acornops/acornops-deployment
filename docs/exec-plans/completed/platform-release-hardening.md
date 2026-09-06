# Platform release hardening execution plan

## Integration — 2026-09-07

Implementation is complete. The user authorized fresh verification followed by
committing and pushing these changes directly to `main`. Earlier no-commit
statements below describe the initial implementation task, not this integration.
No deployment or production data mutation is authorized. Final integration
verification follows:

Fresh `task validate`, `task contracts:check`, `task harness:check`, and
`task platform-contracts` passed. The rendered example still matches the
published matrix pins; no image tags or production deployment were changed.
Diff and harness checks passed after closing this plan.

## Implementation record — 2026-09-06

## Goal and scope

Resolve release audit findings 3 and 4: the documented VM environment must
inherit matrix-checked Compose pins, and operators must distinguish fresh
installation, pre-greenfield reset, and existing greenfield forward migration.
No image publishing, tag changes, commits, pushes, deployments, or data mutations.

## Steps

- [x] Extend `scripts/check-release-matrix.mjs` to render the shipped VM example
  with Docker Compose JSON and compare application and migration-job images
  against `vm-prod-v1`. Run `task release-matrix-check` before fixing the env;
  expect the stale resolved images to fail.
- [x] Remove redundant image overrides from `env/vm/.env.example`; rerun the
  regression and inspect the documented `config --images` output.
- [x] Verify source schema baselines in control-plane SQL migrations and
  gateway Alembic revisions. Route VM/Kubernetes operators in
  `docs/OPERATIONS.md` and `release/stack-versions.yaml`, preserving the MCP
  maintenance/reconnect/rollback procedure and linking hosted-readiness gates.
- [x] Run `task contracts:check`, `task harness:check`, `task validate`, and
  `task platform-contracts`; report sibling-version mismatches without editing
  sibling repositories. Run unaffected focused checks if validation stops early.
- [x] Review exact diff and record evidence and residual release gates here.

## Decisions and risks

- Existing operator env files are not rewritten. Document removal or deliberate
  coordinated replacement of old overrides before upgrades.
- Schema epoch and migration history, not unverified image version ranges,
  determine the route. A representative backup rehearsal and registry/source
  provenance remain release gates, not claims established by config rendering.
- Hosted changes already upstream must not be advertised as present in existing
  published pins without release evidence.

## Validation evidence

- `task release-matrix-check`: failed before env correction on all six
  application/init images, then passed after removing the four overrides.
- Added the same rendered check for generated AgentV installs: failed with
  template `.5` versus matrix `.6`, then passed after removing that override.
  No release tags changed.
- `docker compose -f compose/vm-prod/compose.yaml --profile prod --env-file
  env/vm/.env.example config --images`: passed; management-console `.35`,
  control-plane and init `.34`, execution-engine `.14`, gateway and init `.18`.
- `task contracts:check`, `task harness:check`, `task platform-contracts`, and
  `task validate`: passed, including Compose profile renders, Linux install
  dry-run, Python standards, Helm policies, release matrix, edge and image checks.
- `git diff --check`: passed. Branch: `fix/platform-release-hardening`.
- Source baseline evidence: control-plane `docs/database-migrations.md` and
  `src/infra/migrations.ts` define immutable `001_initial_schema.sql` plus the
  checksum ledger; gateway Alembic files define
  `a10047518e6a -> b20058629f4b -> c3006973a8d2`. Control-plane docs identify
  hosted migrations `007`–`012` as additive. No live database was inspected.
- Residual: sibling execution-engine and gateway manifests declare execution
  contract `3`, while deployment and control-plane declare `2`; gateway lacks
  the capacity contract marker that deployment/control-plane set to `1`.
  `task platform-contracts` compares counterpart surfaces and does not reject
  these top-level differences. These observations concern the current local
  checkout combination, not a verified upstream protocol incompatibility:
  gateway is behind upstream and execution-engine is on a separate branch.
  Read-only upstream inspection resolves the inspected wire boundary as marker
  drift: CP `origin/main` at `1f26413` sends dispatch version `2` and capacity
  version `1`; EE `b8eb8dd` requires `Literal[2]` for requests/snapshots and
  capacity `Literal[1]`; gateway `62ac291` advertises capacity `1` and validates
  that version from CP. EE/gateway contract docs explicitly retain dispatch
  version `2`, despite their top-level manifest marker `3`. Gateway upstream
  includes the capacity marker missing from its local checkout. This bounded
  inspection does not establish a runtime protocol incompatibility or certify
  all payloads; release metadata reconciliation remains separate follow-up.
  Siblings were not modified.
- Skipped: artifact registry verification/publishing, deployments, runtime
  smoke, `prod-ps`/`local-ps`, and database restore rehearsal. No stack was
  started, no production access was authorized, and no representative backup
  was supplied. These release gates remain open; config checks do not certify
  registry contents, source inclusion, or upgrade safety for a live database.

Implementation is ready for review; retain this active plan until changes land.
