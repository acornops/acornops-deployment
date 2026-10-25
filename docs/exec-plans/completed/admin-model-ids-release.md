# Admin-managed model IDs release and demo upgrade

Completed on 2026-10-25. The coordinated releases are published and verified;
the demo was upgraded in place to Helm revision 6 with all five applications
Ready. Additional model IDs remain disabled on demo pending a separate opt-in.

## Scope and authority

On 2026-10-25 the user approved a comprehensive final review, focused fixes,
merge to main, new releases, and a demo deployment upgrade. This supersedes
the implementation-only restriction in the earlier workspace plan.

Use an **in-place upgrade**, not a reset. Preserve demo databases, credentials,
workspaces, enrolled agents, identity data, and unrelated host services. Do not
modify local stack data or make paid provider calls. Publish and verify all
artifacts before pushing demo pins (which automatically starts deployment).

The feature adds default-off admin model IDs for existing deployment-permitted
providers and explicit chat recovery when a selected model becomes unavailable.
It introduces no migration, provider adapter, automatic model switch, or resend.

## Release coordinates

| Component | Published release | Previous demo pin |
| --- | --- | --- |
| Control plane | 0.0.1-experimental.37 | 0.0.1-experimental.36 |
| Platform Admin Console | 0.0.1-experimental.7 | 0.0.1-experimental.6 |
| Management Console | 0.0.1-experimental.39 | 0.0.1-experimental.38 |
| Platform chart | 0.0.1-experimental.25 | 0.0.1-experimental.24 |

Retain the already-published gateway .21, AgentV .9, execution engine .15,
and AgentK .13. Update chart/Compose compatibility pins to these versions so
the new chart does not regress the demo's existing installer and error fixes.
Do not overwrite existing tags. Admin Console requires package/tag equality.

## Execution and validation

- [x] Fetch affected repositories and compare main with origin/main. Keep the
  pre-existing parent `tmp/` untouched.
- [x] Independent whole-feature review: no new Critical, Important, or Minor
  findings; 27 focused control-plane tests passed.
- [x] Capture the live demo baseline: Helm revision 5, chart .24, five Ready
  deployments and the three existing PVC identities. Demo doctor passed.
- [x] Run fresh application, deployment, contract and browser checks. Distinguish
  missing local OS screenshot baselines from product failures; Linux CI must pass.
- [x] Commit focused changes and fast-forward main in each affected repository;
  push without force and wait for exact-SHA CI success.
- [x] Publish unique application tags, wait for successful image releases, and
  verify registry digests and provenance against the tagged commits.
- [x] Validate and publish chart .25 only after every pinned artifact exists;
  verify OCI publication and the chart repository mirror.
- [x] Update only demo version pins; retain the default-off feature flag because
  no separate demo opt-in approval was received.
  Confirm no competing deployment, validate Ansible and secrets references,
  then push once and follow the existing leased deployment workflow.
- [x] Verify all workloads, ingress/TLS and public routes; compare PVC identities
  and enrolled-agent state with the baseline. No paid chat calls.
- [x] Record final versions, commits, CI/release/deploy runs, validation results,
  rollback limits and repository synchronization; move this plan to completed.

## Rollout and rollback

Upgrade all control-plane replicas before any custom metadata is written. The
published chart keeps `platformSettings.aiPolicy.allowAdditionalModels: false`;
demo opt-in is a separate explicit operator choice. No existing model default
or enabled list should change as part of this deployment.

Turning the flag off makes custom IDs inert while retaining their definitions.
Rolling back to an older control plane additionally requires removing/resetting
`additionalProviderModels` in persisted AI policy and removing the new
`allowAdditionalModels` configuration key (or restoring the old chart). A false
value alone is not compatible with the old strict parser. See the AI Policy
section of `docs/OPERATIONS.md`; do not perform a destructive database rollback.

## Baseline and evidence

Existing PVC UIDs (must remain unchanged):

- Application PostgreSQL: `eec5a7af-5237-403b-a4f3-aef7e5cf0039`.
- Redis: `9031dfc0-6c86-4e33-847f-cfc472aa2a40`.
- Identity PostgreSQL: `e008bf21-6a49-426c-99a0-dc545a43e485`.

The existing VM target was online before deployment; its registration is
recorded in the private demo plan for post-upgrade comparison. A read-only
query used the control plane's existing database connection without exposing
credentials. No target or policy data was modified.

Fresh local gates passed: control-plane `npm run validate` (1,326 tests, isolated
temporary PostgreSQL), Admin Console `npm run validate` (104 tests), Management
Console `npm run validate` (1,189 tests), deployment `task validate` and
`task platform-contracts`, workspace `task validate` and `task platform:contracts`,
and demo validation with required Ansible syntax plus secret-reference validation.
Control-plane main is `2bb9142d5389503ea769a739ce7d7f3b28385b53`; Admin Console
main is `9a3bd4b19a7349328b40e513b48d04dabe0b8dcf`. Both exact-SHA CI and image
release workflows passed. Management Console main is
`680d4e47c2ceb59f4859379bf2530ec03854c118`; its complete
[Linux CI](https://github.com/acornops/management-console/actions/runs/40182250135)
passed, including all five route visual jobs with unchanged baselines, 284
fixtures, 24 API-parity cases, and 27 design-system snapshots. The one intentional
snapshot skip is a desktop-only logout case on mobile. Workspace
[CI](https://github.com/acornops/acornops/actions/runs/40180895472) and deployment
[CI](https://github.com/acornops/acornops-deployment/actions/runs/40180992265) also
passed for their exact pushed commits.

The local macOS route check stopped because only Linux route snapshots are
tracked. Its generated macOS images were moved out of the checkout, not accepted
as new baselines. This is not a passing full-browser gate; Linux CI remains
required. Standard Management Console validation and design-system snapshots
passed before that boundary. The later complete Linux CI satisfied this gate.

The final parity review caught a missing Configure AI recovery action after the
composer-retention change. Restored the existing permission-gated button without
new navigation or APIs. The updated readiness test checks editable drafts,
disabled Send, settings navigation, and mobile/docked variants. It also handles
the existing recent-conversation chooser before inspecting the docked composer.
Fresh post-fix `npm run smoke:mcp-parity` passed all 24 cases, and
`VITE_APP_DATA_MODE=control-plane npm run validate` passed all 1,189 unit tests
plus type, contract, design, build, bundle and route checks. The earlier full
fixture run passed 284 cases; Linux CI repeated all 284 against the final commit.

## Published artifact evidence

- Control plane .37: [CI](https://github.com/acornops/control-plane/actions/runs/40180753245)
  and [release](https://github.com/acornops/control-plane/actions/runs/40181089086)
  passed. OCI index digest
  `sha256:e4f193a67af9ae7ef96fce837989b91cd69fcd805ae903ef96e24f7703e122c9`;
  amd64 manifest `sha256:756b2150bb519d74b67999485a5a941aaf0cd585fa1e304e907a9eaae9758146`.
- Platform Admin Console .7:
  [CI](https://github.com/acornops/platform-admin-console/actions/runs/40180770322)
  and [release](https://github.com/acornops/platform-admin-console/actions/runs/40180969338)
  passed. OCI index digest
  `sha256:8fa67e790017aeb47890e09658b1cdd57f7e48f099fb0ea53b5d50e6cef17c9e`;
  amd64 manifest `sha256:dbf5bedc220b7071d46f7abb64f71a80b0c0c5697e1a4280f46f917b0060433f`.
- Management Console .39:
  [CI](https://github.com/acornops/management-console/actions/runs/40182250135)
  and [release](https://github.com/acornops/management-console/actions/runs/40183246890)
  passed, including the release's repeated full preflight/browser gates. OCI
  index digest `sha256:6e59af154e704c02ad7ca7f5c0f12f1d922910fca293637583b28ed12814a7a0`;
  amd64 manifest `sha256:babcf1b7aae0d0b90984e70ac94e51f74303533158b1ec490b2b100780cf9134`.

All three images' provenance source and revision match the tagged repository
commits. `ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true
ACORNOPS_SKIP_CURRENT_PLATFORM_CHART_ARTIFACT=true node
scripts/check-release-matrix.mjs` passed before chart tagging.

Chart .25 at `53b1b73251c9f341cdca8dbc8aea9f5ee25048df` passed
[publication](https://github.com/acornops/acornops-deployment/actions/runs/40185141990).
Its OCI digest is
`sha256:0b5dc7e0f730c73d6a8a94de0f0c0c82a7b9130ab2ef41aa94211bd90c801c30`.
`ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true node scripts/check-release-matrix.mjs`
passed afterward with no skip. The
[mirror workflow](https://github.com/acornops/charts/actions/runs/40185175419) and
[Pages deployment](https://github.com/acornops/charts/actions/runs/40185186977)
passed. Mirror commit `ded110a3a5bcfec26f431fbff121cbe92973a650` is synchronized
locally. The public tarball's SHA-256 matches the index:
`2fefa68f21995fab564ab739fc34e799cc6254706acb127e2c4b75641ed03a16`.

## Live demo acceptance and handoff

Demo commit `a8b8957cfe43db1526baefd09052383cdefa9170` passed configuration
[CI](https://github.com/acornops/demo-infra/actions/runs/40185303990) and the
single push-triggered [deployment](https://github.com/acornops/demo-infra/actions/runs/40185303949).
The existing workflow acquired and released its shared VM lease and performed
the normal atomic Helm upgrade. No manual cluster changes, duplicate dispatch,
teardown, credential rotation, or VM re-enrollment were performed.

- `task demo:verify DEMO_ENV_FILE=.env.demo` and `task demo:verify:public`
  passed: host/Kubernetes diagnostics, console, API auth configuration,
  identity realm, and platform-admin readiness over public HTTPS.
- Helm release `acornops` is deployed at revision 6, chart .25 / appVersion .37.
  All five application deployments and their pods are Ready. The three new
  running image IDs exactly match the published OCI index digests above;
  execution engine .15 and gateway .21 are retained.
- All three PVC UIDs match the baseline. The private before/after checksum of
  platform Secret data is unchanged. The existing VM registration is online
  with a fresh post-upgrade heartbeat. Persisted platform-policy overrides
  remain empty, and the live additional-model opt-in is explicitly false.
- Browser checks reached the Management Console welcome page and each
  console's expected OIDC sign-in form. No credentials were entered and no
  signed-in live model-policy mutation or paid provider call was made. The
  feature's signed-in behavior was validated with local synthetic data and
  the complete Linux browser suites. Verification tabs were closed afterward.
- Final `task validate` and `task platform-contracts` passed again in the
  deployment repository. Demo validation included required Ansible syntax,
  secret-reference validation, and a non-mutating render assertion for the
  actual role template, all five image pins, retained AgentV .9, unchanged AI
  defaults, and the inherited false opt-in.

Source and release records are merged to main; affected local mains and their
remote mains are synchronized. Only this task's fully merged temporary branch
names were removed; commits remain on main. The unrelated parent `tmp/` was
left untouched. The coordination plan is archived under the workspace's
`change-sets/completed/admin-model-ids.md`.

No new provider adapter or SDK was added. A future model ID still requires
compatible provider API support and account access; this release does not
certify arbitrary model IDs or revoke already-authorized in-flight requests.
Follow the rollout/rollback boundary above before enabling additions or
downgrading the backend.
