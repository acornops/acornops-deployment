# Readiness fixes — experimental demo release

Completed on 2026-10-26: releases published and demo upgraded in place to chart
`.27`, Helm revision 8. This closes the scoped demo release, not the separate
[production security and acceptance gates](../active/production-readiness-audit.md).

## Authority and scope

On 2026-10-26 the user requested a final evaluation, publication of the reviewed
changes, and demo redeployment. Upgrade the existing demo in place. Do not reset
data, rotate secrets, change AI policy, touch production, upgrade the user's VM,
or alter unrelated local services. The separate production-readiness audit keeps
its unresolved security and target-environment gates; this is not promotion
approval.

## Release coordinates

Remote main and tags were freshly checked before selecting these unused versions:

| Component | New experimental version | Change |
| --- | --- | --- |
| Management Console | `0.0.1-experimental.40` | Dialog opacity handoff and regressions |
| Control Plane | `0.0.1-experimental.39` | Fail-closed AI policy, conservative VM recovery, HTTP dependencies |
| Execution Engine | `0.0.1-experimental.16` | Disabled-capacity dispatch gate; AnyIO/Certifi patches |
| AgentK | `0.0.1-experimental.14` | Three compatible runtime dependencies; version metadata |
| AgentV | `0.0.1-experimental.11` | Findings before raw inventory limits; optional recovery coverage |
| Platform chart | `0.0.1-experimental.27` | Coordinated component/installer pins |

Gateway `.21` and Platform Admin Console `.7` remain unchanged.

## Execution gates

- [x] Inspect local and remote state; preserve unrelated workspace `tmp/`.
- [x] Fresh independent source review and canonical validation of changed repos.
- [x] Review staged source diffs, commit per repo, publish linked PRs, require CI,
  and merge the component corrections.
- [x] Publish unique tags. Require Linux console visual/fixture checks, AgentK
  Kubernetes/RBAC gates, and AgentV Node 22/24 live systemd gates.
- [x] Verify images/provenance and installer assets; inspect image vulnerabilities
  separately from application lockfile audits. Do not suppress known findings.
- [x] Prepare coordinated pins on the release branch; do not merge/publish the
  deployment matrix until all dependency artifacts exist and verify. Validate and
  publish the chart, then verify its generated public mirror.
- [x] Validate private demo pins and rollback, capture readiness/PVC/secret
  baseline, and require no competing deployment or pending Helm release.
- [x] Push demo pins once to trigger its existing leased, atomic upgrade.
- [x] Verify ready replicas, actual image digests, installer pin, public HTTPS and
  browser entry, retained storage and VM registration. Record limitations and clean only
  task-owned test services.

## Compatibility and rollback

No new database migration. The optional AgentV finding-coverage metadata retains
snapshot v2. Deploy Control Plane first, then offer the new AgentV installer;
old agents remain accepted with conservative recovery. Installed hosts do not
auto-upgrade. Retain the preceding chart `.26` and image pins for rollback;
rollback restores old bugs but needs no database down-migration. Do not use
pending-release cleanup, uninstall, re-enrollment, or data resets.

## Evidence

Fresh local logs: `/tmp/acornops-demo-release-k5O8zQ/`.
Disposable test PostgreSQL/Redis use unique `acornops-release-k5o8zq-*` names,
loopback ports, and a task label. Existing platform/demo resources are untouched
by local test setup.

Independent final source review found no Critical/Important findings. Fresh
validation passed: Control Plane 1,340 tests plus SQL migration upgrade checks;
AgentV 100 tests and package/bootstrap smoke; AgentK 258 tests and Helm checks;
Execution Engine 297 unit/29 keyless scenarios; console 1,189 unit tests and four
targeted dialog motion browser cases; workspace and deployment canonical gates.
The AgentK release bump exposed the existing exact-version assertion; it was
updated to `.14` and the complete suite passed again.

Prepared chart/Compose/matrix pins passed `task validate` and
`task platform-contracts`. Private demo pins passed Ansible syntax, secret-reference
validation and offline rendering assertions for unchanged authentication, model
policy, mTLS, Secret references and disabled pending-release cleanup. A separate
read-only review of both deployment diffs found no actionable issues. Nothing was
deployed until the console and chart artifact gates passed.

Console PR CI passed all Linux visual projects and 288 fixture checks. A main-CI
runner subsequently failed while installing browser dependencies because the
Microsoft apt mirror returned HTTP 403, before tests ran. The failed workflow
jobs were retried without code, baseline or check changes. Main CI
[40221476018](https://github.com/acornops/management-console/actions/runs/40221476018)
and tag-specific release validation passed. The release repeated the full Linux
route matrix, 27 design-system cases (one intentional skip), 288 fixtures and 24
MCP parity cases before image publication.

Reviewed component PRs: [Control Plane #28](https://github.com/acornops/control-plane/pull/28),
[AgentV #4](https://github.com/acornops/agentv/pull/4),
[AgentK #4](https://github.com/acornops/agentk/pull/4),
[Execution Engine #8](https://github.com/acornops/execution-engine/pull/8), and
[Management Console #30](https://github.com/acornops/management-console/pull/30).
Fast-forward integration preserves the exact reviewed source commit, with no
force push or rewritten release tag.

Published and source-provenance-verified:

| Component | Source | Release run | OCI index digest |
| --- | --- | --- | --- |
| AgentK `.14` | `1e8270944da2275251f0462174021654684bf379` | [40220630996](https://github.com/acornops/agentk/actions/runs/40220630996) | `sha256:f258283f7913ad34046bac4a67e6c89fb521ba30f89d4990f43e2d6f1d53813a` |
| AgentV `.11` | `634b226e24bf367efa63c098bbadc41ae25267ca` | [40220630750](https://github.com/acornops/agentv/actions/runs/40220630750) | `sha256:029d10657e6a929db148f3ca2528d42d79f4721b4dd013fb19771115a07fca76` |
| Control Plane `.39` | `19826a1ebb6e2c80e8a3db67204b5752e5e599c5` | [40220839900](https://github.com/acornops/control-plane/actions/runs/40220839900) | `sha256:95a61721049343b4c8833788ad92612dd675fad52bfde8deeb4d2af87182f728` |
| Execution Engine `.16` | `38b94ad1e72e8ddc1e807f87ced389deac9eb9e4` | [40220630354](https://github.com/acornops/execution-engine/actions/runs/40220630354) | `sha256:2a8764291ac536e9457d47362a69fa6402029dde9b90c8fd84fccbdefe890b50` |
| Management Console `.40` | `2f0b84d0f7eaec2d2507ae89eb121114b66edcc1` | [40221479574](https://github.com/acornops/management-console/actions/runs/40221479574) | `sha256:a749b6eafd3007e6e60284cf3bdadb2878e2a96b08ca2207117ad77fdfa4e9eb` |

AgentV installer/archive checksums and GitHub signed attestations passed with
the exact source digest, tag, release workflow and hosted-runner requirements.
The published installer matches the locally tested file byte-for-byte. AgentK
chart mirror and public Pages publication passed. Both agents passed hosted
Kubernetes/systemd gates; Execution Engine passed real multi-container integration
and its actionable image scan before publication.

Platform chart `.27` was released from
`a5e0a3e84922b26e69d841c0c6e790cd5f0445b1` after exact-source main CI and all
published dependency checks passed. [Release 40223697225](https://github.com/acornops/acornops-deployment/actions/runs/40223697225),
the generated mirror and public Pages deployment passed. OCI chart digest:
`sha256:942b1a3d95132c4587ec4d3ef9b3ca072c5c7ef6e7253e40906bd67a7248f5e1`.
The downloaded OCI archive and public mirror match byte-for-byte (SHA-256
`b16f1c3aafde270cdbcfd3e21052b29006e2821a477ea6643615b072399426b8`).
Packaged values match the reviewed source exactly; packaged strict Helm lint and
the complete `ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true task release-matrix-check`
passed with no chart exclusion.

### Image security evidence — not production clearance

Trivy 0.76.1 was downloaded from its official release, checksum-verified and run
from the task temporary directory. Docker Scout was unavailable without login;
no account or global tool configuration was changed. Unsuppressed High/Critical
scans of previous and rebuilt Linux/amd64 images found no new package/advisory
pairs in the five released components. Counts include repeated OS-package findings:
Control Plane 73→71, AgentK 86→69, AgentV 78→78, Execution Engine 46→44,
Management Console 58→58.
Execution Engine has no remaining fixed-version High/Critical finding; its
unfixed base-OS findings still require production risk review.

The other images retain known application Zod/Nodemailer findings plus base-OS
and bundled npm-toolchain findings (including fixable ones). These are not
resolved by refreshing application lockfiles. Remediate/qualify production base
images and runtime toolchains before production promotion; no ignore/suppression
or claim of a clean image scan was added. The console retains 58 fixable base-OS
findings, unchanged from its previous release. Scanner database warnings about unavailable CVE details are recorded
in local logs and are an additional limit, not a finding clearance.

After verifying their IDs and task labels, the two disposable validation
PostgreSQL/Redis containers were stopped and auto-removed. Only synthetic test
data was discarded; the existing local stack and demo were untouched.

## Live demo verification

The single main-path deployment completed successfully, using the existing
leased/atomic upgrade. Helm reports revision 8, chart `.27`, status `deployed`.
All five platform deployments are Ready. The Control Plane, Execution Engine and
Management Console runtime image IDs equal the verified OCI index digests above;
Gateway `.21` and Platform Admin Console `.7` remain the selected versions.
The Control Plane advertises AgentV installer `.11`.

`task demo:verify DEMO_ENV_FILE=.env.demo` passed: host/k3s, platform readiness,
console/API HTTPS, identity realm and admin readiness. The public console now
serves `index-BI6qe04P.js`, replacing `index-vT_P7jdM.js`. Browser navigation
rendered the console without captured errors and reached the expected SSO login.
No authenticated browser session was available, so signed-in live flows were not
retested; hosted visual, fixture and MCP browser gates passed separately. No paid
model request or workspace mutation was made for acceptance.

Read-only before/after assertions confirmed identical PVC identities, platform
Secret checksum, workspace and target identifiers. The existing VM remains online
on AgentV `.10`, with heartbeat `2026-10-25T19:12:51.886Z` and telemetry snapshot
`2026-10-25T19:12:52.245Z`, both after the new Control Plane pod started. Installed
VMs still need the operator's **Upgrade or repair AgentV** step for `.11` coverage
improvements; no user-VM host was changed. The shared deployment lease was released.

Final documentation validation: deployment `task validate` and
`task platform-contracts` passed; private demo validation and Ansible syntax passed
using a task-local temporary directory after sandbox restrictions blocked the
default Ansible cache. Secret values were never printed or stored in evidence.
