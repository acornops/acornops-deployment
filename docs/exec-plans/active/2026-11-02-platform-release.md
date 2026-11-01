# Coordinated experimental release and demo upgrade

## Goal and authority

The user authorized merging the audited VM work into main, publishing every
component with unreleased changes, and upgrading the existing demo for testing.
This is an experimental demo release, not Windows production qualification.

Use `chore/platform-release-20261102` for release metadata. Preserve unrelated
draft plans and open refactor PRs. Keep Windows enrollment disabled; publish only
the existing Linux AgentV release assets. Preserve demo databases, identities,
credentials, workloads, and existing installed agents. No reset or re-enrollment.

## Intended versions

| Component | Version |
| --- | --- |
| Control Plane | `0.0.1-experimental.44` |
| Management Console | `0.0.1-experimental.46` |
| Execution Engine | `0.0.1-experimental.19` |
| LLM Gateway | `0.0.1-experimental.23` |
| Platform Admin Console | `0.0.1-experimental.8` |
| AgentK image and chart | `0.0.1-experimental.16` |
| AgentV Linux image and installer | `0.0.1-experimental.15` |
| Platform chart | `0.0.1-experimental.31` |

## Execution gates

- [x] Inventory current remote refs, release tags, CI and local dirty state.
- [ ] Merge the five reviewed VM PRs; retain current-main documentation changes.
- [ ] Validate version-only changes and resolve the Gateway CI timing failure
  without weakening runtime acceptance. Require successful CI for exact sources.
- [ ] Publish unique immutable component tags through existing workflows; verify
  image provenance, Linux installer checksums/attestations, and AgentK chart mirror.
- [ ] Align Compose, Helm and release-matrix pins. Run `task validate`,
  `task platform-contracts`, and published-artifact checks. Review the release diff
  before publishing the platform chart and checking its public mirror.
- [ ] Capture live demo readiness, retained data/credential hashes and migration
  history. Back up the databases before forward migrations. Verify no concurrent
  deployment or pending Helm release. Count workflow history and issue observations
  older than the configured retention period, plus expired generated documents,
  before the new startup sweep; reconcile any eligible demo records before rollout.
- [ ] Update only demo version pins and remove its retired automation-mode
  override. Validate with `task validate`; push once to use the leased atomic
  deployment workflow. Verify health, image digests, migrations, retention,
  Linux agent recovery, generated installation versions, and public HTTPS.

## Compatibility and rollback

Execution contract 2 and schema epoch `greenfield-1` remain unchanged. From the
demo's Control Plane .42, migrations 013–015 add indexes and observation columns.
Inspect live migration history before applying them. Gateway migration ancestry
must match; no database reset, stamping, or downgrade is authorized. Preserve old
image digests, Helm values, migration inventories and a database backup.

The demo starts at Helm revision 16 with chart .30, Control Plane .42, console .45,
engine .18, gateway .22, admin .7 and generated AgentV installer .14. If application
rollback is required, restore the complete previous infra revision and values,
including its `automation.runtimeMode=on` setting, or roll back to saved Helm
revision 16 under the shared deployment lease. Restoring image pins alone would
disable workflows on the older chart. Check compatibility with applied forward
migrations; Helm rollback cannot restore rows removed by retention sweeps. Do not
uninstall or delete Helm metadata. Existing installed agents require a separate explicit
upgrade; selecting a new installer/chart only updates generated commands.

## Evidence and known limits

Evidence is collected under `/private/tmp/acornops-platform-release-20261102`.
Current Gateway main CI failed one existing shutdown timing assertion (0.916 s
against 0.9 s; 921 tests passed). A hosted rerun and local process checks are
required before publication. Windows native cold-start, rollback sharing, real
reboot and qualification gates remain in AgentV's qualification decision. Linux
power-cycle recovery, broader production acceptance and unrelated source plans
remain outside this demo rollout.
