# Coordinated experimental release and demo upgrade

Completed 2026-11-02: all seven runtime components and both charts are published.
The demo upgrade passed at Helm revision 17; Windows remains disabled.

## Goal and authority

The user authorized merging the audited VM work into main, publishing every
component with unreleased changes, and upgrading the existing demo for testing.
This is an experimental demo release, not Windows production qualification.

Use `chore/platform-release-20261102` for release metadata. Preserve unrelated
draft plans and open refactor PRs. Keep Windows enrollment disabled; publish only
the existing Linux AgentV release assets. Preserve demo databases, identities,
credentials, workloads, and existing installed agents. No reset or re-enrollment.

## Published versions

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
- [x] Merge the five reviewed VM PRs; retain current-main documentation changes.
- [x] Validate version-only changes and recheck the Gateway CI timing assertion
  without weakening runtime acceptance. Require successful CI for exact sources.
- [x] Publish unique immutable component tags through existing workflows; verify
  image provenance, Linux installer checksums/attestations, and AgentK chart mirror.
- [x] Align Compose, Helm and release-matrix pins. Run `task validate`,
  `task platform-contracts`, and published-artifact checks. Review the release diff
  before publishing the platform chart and checking its public mirror.
- [x] Capture live demo readiness, retained data/credential hashes and migration
  history. Back up the databases before forward migrations. Verify no concurrent
  deployment or pending Helm release. Count workflow history and issue observations
  older than the configured retention period, plus expired generated documents,
  before the new startup sweep; reconcile any eligible demo records before rollout.
- [x] Update only demo version pins and remove its retired automation-mode
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
The initial Gateway main CI failed an existing shutdown timing assertion (0.916 s
against 0.9 s; 921 tests passed). The same-source hosted rerun passed all 922 tests
and integration/supply-chain gates; 14 focused local process tests also passed.
No timing threshold or runtime code was changed. This is rerun evidence, not a
causal repair of that timing failure. Windows native cold-start, rollback sharing, real
reboot and qualification gates remain in AgentV's qualification decision. Linux
power-cycle recovery, broader production acceptance and unrelated source plans
remain outside this demo rollout.

## Source and release evidence

| Component | Source | Successful release workflow |
| --- | --- | --- |
| control-plane | [`a8f2b0a`](https://github.com/acornops/control-plane/commit/a8f2b0a3247682928e5ed55679f6af383e930154) | [41354194216](https://github.com/acornops/control-plane/actions/runs/41354194216) |
| management-console | [`ee677e5`](https://github.com/acornops/management-console/commit/ee677e53fa191f9370432d9b593fa362342f7d7c) | [41354504811](https://github.com/acornops/management-console/actions/runs/41354504811) |
| execution-engine | [`1d6dd4e`](https://github.com/acornops/execution-engine/commit/1d6dd4edd3f9273b3b1de9aad2936ee190f6b406) | [41353766521](https://github.com/acornops/execution-engine/actions/runs/41353766521) |
| llm-gateway | [`2fe5f2b`](https://github.com/acornops/llm-gateway/commit/2fe5f2bf735b834eedd8131e773ea911e6470bdd) | [41353947246](https://github.com/acornops/llm-gateway/actions/runs/41353947246) |
| platform-admin-console | [`300285b`](https://github.com/acornops/platform-admin-console/commit/300285b04f9240078b7d09c9ff416f5efc112f35) | [41354599162](https://github.com/acornops/platform-admin-console/actions/runs/41354599162) |
| agentk | [`a910b33`](https://github.com/acornops/agentk/commit/a910b3313ba9361dc196565183434338f25e80fb) | [41354911006](https://github.com/acornops/agentk/actions/runs/41354911006) |
| agentv | [`eefa7a9`](https://github.com/acornops/agentv/commit/eefa7a97d00b22e0db1bd0c75fee4bad412f22ae) | [41356125389](https://github.com/acornops/agentv/actions/runs/41356125389) |
| Platform chart | [`3d3f03d`](https://github.com/acornops/acornops-deployment/commit/3d3f03de25ed14cdf2339e0570cbcae7cee34354) | [41357268630](https://github.com/acornops/acornops-deployment/actions/runs/41357268630) |

All seven image attestations identify the exact source commits above. AgentV
archive and bootstrap checksums and GitHub-signed provenance pass with the source
digest, tag and signer workflow enforced. Only Linux assets were published.
AgentK .16 and platform .31 public chart mirrors match their OCI packages. All
26 packaged platform files match source (Chart.yaml compared structurally).
Platform chart OCI digest:
`sha256:2ce401ad27c6f397e3f192f06057de388eae01ce5af66826b5c4376e669b27ce`.

Local `npm run validate` passed for AgentV (264 units and 28 fixtures), AgentK
(359 tests), and admin (113 tests); AgentV `npm run smoke:package` passed.
Deployment `task validate`, `task platform-contracts`, workspace `task validate`,
and demo `ANSIBLE_SYNTAX_REQUIRED=true task validate` passed. Component main and
release CI passed; the console release also passed 335 fixture and 24 MCP-parity
browser checks. Published dependency checks passed before and after chart
publication, using `ACORNOPS_RELEASE_VERSION=0.0.1-experimental.31 ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true task release-matrix-check`.

The five original VM PRs merged: AgentV #8, Control Plane #33, console #35,
docs-website #19 and workspace #27. Their main CI passed and Mintlify deployed
successfully. Unrelated local plans and draft refactor PRs were preserved.

## Demo acceptance

The single automatic [deployment](https://github.com/acornops/demo-infra/actions/runs/41357402251)
from demo source `014504c` passed at 2026-11-01 22:41:26 UTC. Both application
database backups were restored into temporary verification databases before
rollout; migrations 013–015 passed there, then all temporary databases were
removed. Retention-eligible workflow histories, observations and documents were
zero before startup. No database reset or re-enrollment was performed.

`task demo:verify DEMO_ENV_FILE=.env.demo` passed all public endpoints and runtime
checks. Five Linux/amd64 pods use the verified immutable OCI indexes and have no
restarts. All 15 Control Plane migration checksums match source; Gateway stays
at `c3006973a8d2`. Workspace/target/registration/VM-credential hashes, platform
secret hash and all three PVC identities match the pre-upgrade baseline.
Both existing agents (AgentV .14 and AgentK .15) are online with fresh heartbeats
and inventory after rollout completion. The effective heartbeat grace is 120 s;
Windows is false and new Linux installer commands select AgentV .15. AgentK
keeps its existing latest-chart selection; .16 is published. Installed agents
were not upgraded. The shared deployment lease is released.

Authenticated user journeys, provider-backed runs, native Windows activation,
real reboot/power-loss recovery and broader production acceptance were not
performed by this release. The user can now perform demo acceptance testing.
