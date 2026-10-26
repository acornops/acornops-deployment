# Approval resume and compact capability preview release

Completed 2026-10-27. Demo runs chart `.29`, revision 12; all five platform
services are Ready, with retained data, credentials and the existing VM enrollment.

User-approved scope: verify and release the focused approval lifecycle, safe
approval error, AgentV restart-precondition guidance, and restored compact
capabilities list. Upgrade demo in place only; no reset, production deployment,
secret rotation, paid model call, or upgrade/restart of the user's VM agent.

## Release coordinates

- Control Plane `0.0.1-experimental.41` (previous `.40`).
- Execution Engine `0.0.1-experimental.17` (previous `.16`).
- Management Console `0.0.1-experimental.42` (previous `.41`).
- AgentV image and systemd assets `0.0.1-experimental.13` (previous `.12`).
- Platform chart `0.0.1-experimental.29` (previous `.28`).
- Gateway `.21`, admin console `.7`, and AgentK `.15` stay unchanged.

## Checklist

- [x] Re-run component validation and focused browser tests; preserve the prior
  isolated integration and independent-review evidence in each component plan.
- [x] Commit related changes separately, link PRs, pass hosted CI, and integrate
  into main. Publish new immutable tags only from verified source.
- [x] Verify image digests/provenance, AgentV live systemd gates and release
  assets, then validate and publish the coordinated matrix/chart.
- [x] Confirm the OCI chart and public chart mirror agree byte for byte.
- [x] Capture read-only demo versions, health, PVC UIDs, and identity/credential
  hashes. Keep all existing AI policy and values.
- [x] Under the shared deployment lease, upgrade Control Plane first using the
  previous chart and `--reuse-values --atomic`. Confirm readiness before the new
  engine can resume runs. Stop if the Helm release is pending or preconditions fail.
- [x] Update demo pins once; its main push triggers the normal deployment
  workflow. The demo-only PostgreSQL memory fix also triggers the dependency-only
  workflow: identify it by the exact merge SHA, cancel before its deployment step
  and verify that no mutation started. Only the full workflow holds the shared
  lease. Do not interrupt an in-progress mutation or dispatch a duplicate run.
- [x] Verify new images, installer pin, HTTP/browser health, fresh VM heartbeat
  and telemetry, unchanged PVCs/secrets/identities/credentials, and released lease.
- [x] Record release evidence, rollback and remaining user acceptance; archive
  this plan. Reconcile the documentation closeout through its PR before handoff.

## Rollback and acceptance

There are no new database migrations or wire-shape changes. Keep the old images
and chart available. If necessary, restore the previous pinned matrix using the
normal atomic rollout with retained values; do not reset databases or credentials.
Rolling back restores the known approval-resume bug and the taller popup.

Publishing AgentV changes generated commands, not installed hosts. The owner
must explicitly run **Upgrade or repair AgentV** to receive the updated tool
descriptions. No actual service restart or paid chat is part of this release
verification. Existing production security/staging/recovery gates remain in
[the production audit](../active/production-readiness-audit.md); demo success is
not production certification.

## Source qualification

All product PRs passed hosted CI and were squash-merged; each integrated tree
was checked against its tested PR head. The coordinated deployment pins were
merged before publishing the chart. All component versions are immutable tags.

| Repository | Integrated source | Pull request |
| --- | --- | --- |
| Control Plane | `0f6e1dd3c83fb09c7844e4aea183e7fa9ef43dc5` | [30](https://github.com/acornops/control-plane/pull/30) |
| Execution Engine | `4f5602e75406a6e1d05f116068b970abb94ca527` | [10](https://github.com/acornops/execution-engine/pull/10) |
| AgentV | `83269abfa1033219150c68e488e091bdf86f33b3` | [6](https://github.com/acornops/agentv/pull/6) |
| Management Console | `928c090de4ce26fa326902d56f9e52445cf2f511` | [31](https://github.com/acornops/management-console/pull/31) |
| Deployment pins | `a59133380f46f7ebc875ee486eb077bc4264cfa4` | [25](https://github.com/acornops/acornops-deployment/pull/25) |

Fresh release qualification passed:

- Control Plane `npm run validate`: 1,382 tests plus real PostgreSQL races,
  migrations, authorization, events, OpenAPI, contracts, types, style and build.
  Separate disposable PostgreSQL/Redis instances were used and removed.
- Execution Engine `task validate`: 315 unit tests, 29 keyless evaluations and
  lint/contracts/harness. Hosted CI also passed the isolated integration suite.
- AgentV `npm run validate`, `npm run test:e2e`, `npm run smoke:package`: 107 unit
  tests, four transport tests and package smoke. Its release passed live Ubuntu
  Node 22/24 systemd gates. No user-VM operation was performed.
- Management Console `VITE_APP_DATA_MODE=control-plane npm run validate`: 1,190
  unit tests and all canonical gates. The focused Playwright fixture suite passed
  45 tests, including 200-tool scrolling, keyboard focus, full/quick chat, both
  themes, small viewports and Agent/Kubernetes/VM scopes. Main CI's full browser
  matrix passed. Production code changes only restore the existing 224px inner
  scroll limit and keyboard focusability; no unrelated layout changes.
- Deployment `task validate`, `task platform-contracts`, and workspace
  `node scripts/harness/check-platform-contracts.mjs` passed.

The original focused fixes and compact popup received independent reviews. A
late-start state race found in review was reproduced and corrected atomically,
then requalified before integration. No permission, approval, exact-precondition,
durable-write-claim or cancellation safeguard was relaxed.

## Backend-first stage and demo database sizing

Original baseline: chart `.28`, revision 10, all five services Ready and the
existing VM online on AgentV `.10`. Captured PVC UIDs and hashes of the platform
Secret, workspace/target identities, registrations and VM credentials without
exposing values. No competing lease was present.

The leased atomic backend-first upgrade retained chart `.28` and existing values,
changing only Control Plane `.40` to `.41`. Revision 11 became Ready, public health
checks passed and baseline hashes remained identical before engine rollout.

This stage exposed demo PostgreSQL's inherited `nano` 192 MiB limit: one OOM kill
at `2026-10-26T18:20:48Z` caused two Control Plane startup connection refusals;
both recovered. The 16 GiB demo host had about 11 GiB available memory. Private
demo PR 13 sets explicit PostgreSQL memory request/limit to 256 MiB/1 GiB while
preserving CPU, ephemeral storage, PVC, database and credentials. Red/green
actual-template tests, exact chart `18.8.0` rendering, required Ansible validation,
and independent review passed. This is demo sizing, not production sizing or an
application-code change. Keep this headroom during any image rollback.

## Published artifacts

All four release workflows passed: Control Plane
[40376244255](https://github.com/acornops/control-plane/actions/runs/40376244255),
Execution Engine
[40375240374](https://github.com/acornops/execution-engine/actions/runs/40375240374),
AgentV [40375055074](https://github.com/acornops/agentv/actions/runs/40375055074),
and Management Console
[40376044589](https://github.com/acornops/management-console/actions/runs/40376044589).
The console tag reran the full sequential browser suite before image publication.
OCI provenance matches the integrated source above. AgentV archive and bootstrap
checksums and signed attestations match its tag, source and release workflow.

| Image | OCI index digest |
| --- | --- |
| Control Plane `.41` | `sha256:4a6e062f3e46272380d8533df5c41a7a96b260f6303740386191235de7494c3f` |
| Execution Engine `.17` | `sha256:3205a4ee9306a12e5aac9809c988fee2976cbd1b7024c8815b4c47263c5a43aa` |
| AgentV `.13` | `sha256:3fe2c9483e54f00c8ddba4b47579385e3758f6cd54bda37a002fc8c609456036` |
| Management Console `.42` | `sha256:ed204468cceafd57fda2dca6ce70f5808e559c511a94ea967d9443bb4f976740` |

Platform chart publication
[40381721006](https://github.com/acornops/acornops-deployment/actions/runs/40381721006)
passed. Its OCI digest is
`sha256:620f14798de4963fd2a1b6267694ecd7fef3a9fa571a39c4905646bcc94df099`;
archive SHA-256 is
`16b6d15f4aba0e014cd4fc2fffe95f34d467b506b82656262b05f48db334b452`.
The public mirror is byte-identical, resolves through the public Helm index, and
was synchronized locally at charts commit `3f09cce`. The complete published
matrix check passed without skipping the current chart.

Fresh Trivy scans introduce no new High/Critical package/advisory pairs relative
to the prior releases. Existing findings are **not waived for production**:

| Image | High | Critical | Findings with a fixed version |
| --- | ---: | ---: | ---: |
| Control Plane `.41` | 67 | 1 | 10 |
| Execution Engine `.17` | 44 | 0 | 0 |
| AgentV `.13` | 75 | 1 | 10 |
| Management Console `.42` | 56 | 2 | 58 |

## Final demo acceptance

Demo merge `66bc9c99f323755b67c3dd6f863d21730323a91f` triggered full
[deployment 40382017084](https://github.com/acornops/demo-infra/actions/runs/40382017084),
which passed, as did merged-source CI. Redundant dependency-only run
`40382017167` was cancelled while queued, before any job or deployment step.
No second dispatch, pending-release cleanup, reset or secret upload was used.

`task demo:verify DEMO_ENV_FILE=.env.demo` and the explicit before/after assertions
passed. Helm reports chart `.29`, revision 12, `deployed`. All five platform
deployments are Ready; updated image IDs match the verified digests and generated
AgentV commands select `.13`. The following remained unchanged:

- All PVC UIDs and the platform Secret checksum.
- Workspace/target identities, agent registrations and VM credential hashes.
- Gateway/admin-console versions, AI policy, and the user's installed AgentV `.10`.

The VM remains online; heartbeat `2026-10-26T19:08:11.272Z` and telemetry snapshot
`2026-10-26T19:08:11.594Z` are newer than the final upgrade. PostgreSQL's live
memory request/limit is 256 MiB/1 GiB; its image, CPU and ephemeral resources are
unchanged. Repeated observations found seven Ready application/data pods with
stable identities and restart counts; Control Plane and PostgreSQL both have
zero post-rollout restarts. This short observation is not a capacity soak test.

A nonexistent-run probe through the deployed engine and real internal Control
Plane connection returned the typed safe approval error without an internal URL;
it created no approval/run and performed no write. Public console/API/identity/
admin health checks passed. The new console bundle is `index-BFyXoUQ7.js`; browser
inspection verified rendering and OIDC navigation. No authenticated session was
available, so live signed-in popup/chat acceptance is not claimed. Those UI
regressions passed local fixture and hosted browser gates.

The shared lease was released. No production deployment, user-VM upgrade/service
restart, paid model request, credential rotation or local-stack reset occurred.
Use VM Settings -> Upgrade or repair AgentV separately, then a new controlled
troubleshooting run, for owner acceptance. A full rollback targets chart `.28`
and its original complete image matrix (revision 10), not the intermediate
backend-only revision 11; retain the increased database memory allowance.

Local release evidence is in `/tmp/acornops-approval-release-CPQ48f/`; source
validation logs are `/tmp/acornops-release-*-validation.log`.
