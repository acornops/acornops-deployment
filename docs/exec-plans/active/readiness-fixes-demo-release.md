# Readiness fixes — experimental demo release

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
- [ ] Publish unique tags. Require Linux console visual/fixture checks, AgentK
  Kubernetes/RBAC gates, and AgentV Node 22/24 live systemd gates.
- [ ] Verify images/provenance and installer assets; inspect image vulnerabilities
  separately from application lockfile audits. Do not suppress known findings.
- [ ] Prepare coordinated pins on the release branch; do not merge/publish the
  deployment matrix until all dependency artifacts exist and verify. Validate and
  publish the chart, then verify its generated public mirror.
- [ ] Validate private demo pins and rollback, capture readiness/PVC/secret
  baseline, and require no competing deployment or pending Helm release.
- [ ] Push demo pins once to trigger its existing leased, atomic upgrade.
- [ ] Verify ready replicas, actual image digests, installer pin, HTTPS and browser
  behavior, retained storage and VM registration. Record evidence and clean only
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
read-only review of both deployment diffs found no actionable issues. Nothing is
deployed until the console and chart artifact gates pass.

Console PR CI passed all Linux visual projects and 288 fixture checks. A main-CI
runner subsequently failed while installing browser dependencies because the
Microsoft apt mirror returned HTTP 403, before tests ran. The failed workflow
jobs were retried without code, baseline or check changes; final results follow.

Reviewed component PRs: [Control Plane #28](https://github.com/acornops/control-plane/pull/28),
[AgentV #4](https://github.com/acornops/agentv/pull/4),
[AgentK #4](https://github.com/acornops/agentk/pull/4),
[Execution Engine #8](https://github.com/acornops/execution-engine/pull/8), and
[Management Console #30](https://github.com/acornops/management-console/pull/30).
Fast-forward integration preserves the exact reviewed source commit, with no
force push or rewritten release tag.

Published and source-provenance-verified so far:

| Component | Source | Release run | OCI index digest |
| --- | --- | --- | --- |
| AgentK `.14` | `1e8270944da2275251f0462174021654684bf379` | [40220630996](https://github.com/acornops/agentk/actions/runs/40220630996) | `sha256:f258283f7913ad34046bac4a67e6c89fb521ba30f89d4990f43e2d6f1d53813a` |
| AgentV `.11` | `634b226e24bf367efa63c098bbadc41ae25267ca` | [40220630750](https://github.com/acornops/agentv/actions/runs/40220630750) | `sha256:029d10657e6a929db148f3ca2528d42d79f4721b4dd013fb19771115a07fca76` |
| Control Plane `.39` | `19826a1ebb6e2c80e8a3db67204b5752e5e599c5` | [40220839900](https://github.com/acornops/control-plane/actions/runs/40220839900) | `sha256:95a61721049343b4c8833788ad92612dd675fad52bfde8deeb4d2af87182f728` |
| Execution Engine `.16` | `38b94ad1e72e8ddc1e807f87ced389deac9eb9e4` | [40220630354](https://github.com/acornops/execution-engine/actions/runs/40220630354) | `sha256:2a8764291ac536e9457d47362a69fa6402029dde9b90c8fd84fccbdefe890b50` |

AgentV installer/archive checksums and GitHub signed attestations passed with
the exact source digest, tag, release workflow and hosted-runner requirements.
The published installer matches the locally tested file byte-for-byte. AgentK
chart mirror and public Pages publication passed. Both agents passed hosted
Kubernetes/systemd gates; Execution Engine passed real multi-container integration
and its actionable image scan before publication.

### Image security evidence — not production clearance

Trivy 0.76.1 was downloaded from its official release, checksum-verified and run
from the task temporary directory. Docker Scout was unavailable without login;
no account or global tool configuration was changed. Unsuppressed High/Critical
scans of previous and rebuilt Linux/amd64 images found no new package/advisory
pairs in these four components. Counts include repeated OS-package findings:
Control Plane 73→71, AgentK 86→69, AgentV 78→78, Execution Engine 46→44.
Execution Engine has no remaining fixed-version High/Critical finding; its
unfixed base-OS findings still require production risk review.

The other images retain known application Zod/Nodemailer findings plus base-OS
and bundled npm-toolchain findings (including fixable ones). These are not
resolved by refreshing application lockfiles. Remediate/qualify production base
images and runtime toolchains before production promotion; no ignore/suppression
or claim of a clean image scan was added. The console image scan follows its
publication. Scanner database warnings about unavailable CVE details are recorded
in local logs and are an additional limit, not a finding clearance.

After verifying their IDs and task labels, the two disposable validation
PostgreSQL/Redis containers were stopped and auto-removed. Only synthetic test
data was discarded; the existing local stack and demo were untouched.
