# Filesystem capacity fix release and demo upgrade

## Goal, scope and authority

On 2026-10-25 the user requested another correctness review, merge to main,
publication, and demo redeployment. Execute the already-approved scoped fix;
no new alert types, thresholds, UI components, dependencies or APIs.

AgentV excludes inherently immutable image formats from capacity findings.
Control-plane inventory consumes those findings instead of repeating a raw
percentage rule. Snap paths, loop devices and namespace read-only flags are not
used as exclusions. Raw measurements and ordinary filesystem alerts remain.

## Release coordinates and files

- AgentV `0.0.1-experimental.10`: package version/lock/config assertion plus the
  reviewed finding code, regression tests and operations documentation.
- Control-plane `0.0.1-experimental.38`: reviewed inventory mapping/tests/docs.
- Platform chart `0.0.1-experimental.26`: `Chart.yaml`, `values.yaml`,
  `compose/vm-prod/compose.yaml`, and `release/stack-versions.yaml`.
- Private demo pins select those releases; other application versions, AI
  settings, credentials, databases and enrolled targets remain unchanged.

## Execution gates

- [x] Inspect fresh remote main/tags and local changes; all affected baselines
  match remote main. Keep the pre-existing workspace `tmp/` untouched.
- [x] Independent pre-merge source review found no actionable issues, including
  snapshot trimming, genuine disk pressure, retained data and issue recovery.
- [x] Run fresh AgentV validation, full coverage, package and curl compatibility
  smoke, and control-plane validation against isolated test databases.
- [x] Commit focused changes, fast-forward main, push without force, and require
  successful exact-SHA CI. Publish unique tags without overwriting any release.
- [x] Require AgentV's hosted Node 22/24 systemd gates; verify published archive
  and installer checksums/provenance and both component image manifests.
- [x] Validate deployment with `task validate`, `task platform-contracts`, and
  the published-artifact matrix before chart publication; then verify the full
  matrix, chart mirror and Pages publication without a chart skip.
- [x] Validate private demo with required Ansible syntax and secret references.
  Confirm no competing deployment; push pins once to trigger the existing
  leased in-place workflow, not a duplicate dispatch or a teardown.
- [x] Verify demo readiness, actual image/installer pin, public routes, PVC and
  enrollment preservation; record exact versions, commits and workflow runs.
- [x] Push all release commits to main and archive this record; verify the
  final documentation commits leave local and remote mains synchronized.

## Rollout, rollback and limits

Deploy control-plane before upgrading installed agents for consistent badges;
either order remains compatible with the unchanged v2 snapshot. Existing false
issues recover and resolve through normal subsequent-snapshot reconciliation.
No manual issue deletion or database migration is needed.

Demo redeployment only selects the new installer for future commands. Existing
user VM agents are not automatically updated. Host upgrade authority is a
separate choice; never rotate credentials or re-enroll for a routine upgrade.
Rollback can restore old false positives, but requires no schema/data rollback.

Existing Zod advisory and staging physical-reboot acceptance are not waived by
an experimental demo release. Do not run destructive CI host preparation on the
demo or user's VM. No paid provider calls or unrelated service restarts.

## Completion

Released and deployed on 2026-10-25. Baseline demo: chart .25, Helm revision 6;
verified outcome: chart .26, Helm revision 7, all five applications Ready.
Private demo record owns host-specific preservation evidence.

Fresh local evidence: AgentV `npm run validate`, `npm run test:coverage:all`
(95 tests), `npm run smoke:package` and `npm run smoke:curl-compat` all passed.
Control-plane `npm run db:migrate && npm run validate` passed against temporary
PostgreSQL 16/Redis 7 containers (1,327 tests, no skips). Post-merge `npm test`
passed again in both repositories. Deployment `task validate` and
`task platform-contracts` passed with the proposed pins. Demo validation with
required Ansible syntax and secret-reference checks passed; a localhost-only
render of the actual role template confirmed the three new pins, retained
application versions and unchanged AI defaults (`ok=3`, `changed=0`).

AgentV main `43c3af193ff906e614288bc128b49559edd44455` passed
[CI](https://github.com/acornops/agentv/actions/runs/40203611292), including
Ubuntu 24.04 live systemd gates on Node 22 and 24. Control-plane main is
`d64153e4fd7ff8aaa5adbb506073f12b20070822`, with passing
[CI](https://github.com/acornops/control-plane/actions/runs/40203725965).
Both mains and their unique release tags are pushed.

AgentV [release](https://github.com/acornops/agentv/actions/runs/40203848475)
and control-plane
[release](https://github.com/acornops/control-plane/actions/runs/40204343139)
passed. Downloaded AgentV archive and bootstrap checksums passed; GitHub signed
attestations verified the exact source SHA, tag and hosted release workflow.
The downloaded bootstrap is byte-identical to the locally verified package.
Published image indexes are AgentV
`sha256:661e3343aad3941d15988b06d591ef97dd8c44e462ec0303dd973d74c4f30b98`
and control-plane
`sha256:207f60e3cac14749c405bfa483fdafa96f67cccb11b06884d19dc0989573314a`.
`ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true
ACORNOPS_SKIP_CURRENT_PLATFORM_CHART_ARTIFACT=true node scripts/check-release-matrix.mjs`
passed before chart publication. Only the not-yet-published current chart was
skipped; full verification remains required after publication.

Private demo validation also passed after disabling its existing automatic
pending-Helm-release cleanup setting. This release preserves the deployment:
pending state must stop for inspection, not uninstall the release. No new role
logic, secret changes or cleanup commands were introduced.

Chart source `beb58077c5e9aac3f775e788e9234a22a5807796` passed
[CI](https://github.com/acornops/acornops-deployment/actions/runs/40204565037)
and [release](https://github.com/acornops/acornops-deployment/actions/runs/40204654326).
Chart .26 has appVersion .38 and OCI digest
`sha256:aac7c1f2e4b3aaf932874ed6430cf5101b6878786ed1c9e6433a249a522b5aad`.
The full published-artifact matrix passed without skips. Image provenance
revisions matched both application commits. The generated
[mirror](https://github.com/acornops/charts/actions/runs/40204687080) and
[Pages](https://github.com/acornops/charts/actions/runs/40204699115) succeeded;
the public chart download is byte-identical to OCI, and packaged values match
the reviewed source. Generated charts main is
`c7cef450abc4ebce43ebb5f2b4b64b6e7ec402ed`.

Temporary PostgreSQL/Redis test containers created for this validation were
stopped and auto-removed after verifying their task labels. Existing local
stack containers, databases and pre-existing workspace files were not changed.

Private demo commit `ff58812deb44982f1d9a4c3db71577b159ff77db` passed CI and
its existing leased in-place deployment workflow. Post-rollout
`task demo:verify DEMO_ENV_FILE=.env.demo` passed, including HTTPS console/API,
identity and admin readiness. Runtime control-plane digest matched the verified
`.38` image; its installer environment is `.10`. PVC identities, the platform
Secret checksum and VM registration were preserved. No reset, secret upload,
paid provider calls or manual database changes were performed.

The enrolled user VM remains online on AgentV `.9`. Its immutable-image alerts
cannot clear until its separate **Upgrade or repair AgentV** operation runs.
That host mutation was not authorized or performed by this release task. The
unchanged four service-failure issues are outside this filesystem fix. Browser
flows and the user's host upgrade were not exercised; runtime configuration and
public route checks were read-only. The full application suites, hosted release
gates and unchanged-contract checks passed as recorded above.
