# Demo release and fresh deployment implementation plan

> **Completed 2026-10-24:** Images/chart published, demo-only data reset and fresh deployment succeeded, and live infrastructure/public-route/browser sign-in checks passed. Signed-in onboarding, an actual VM connection and paid-model acceptance were not exercised; this is not blanket production certification.

**Goal:** Publish the outstanding platform changes, rebuild the disposable demo with fresh data, and hand over real-VM onboarding instructions.

**Architecture:** Use the existing tag-driven release workflows and pinned platform chart. Publish and verify artifacts before resetting the demo; use the existing demo-infra teardown and deployment tasks, not ad hoc host cleanup.

**Tech stack:** GitHub Actions, GHCR, Helm, Ansible, k3s, Ubuntu 24.04, AgentV systemd installer.

**Spec:** User request dated 2026-10-24; deployment and demo-infra operations guides; AgentV operations guide.

## Constraints and review focus

- Demo only. Preserve the local Docker stack, host OS, SSH access, k3s, Monit, the separate k3d workload cluster, and unrelated host applications.
- The requested fresh demo deletes application databases, credentials, workspace/target registrations, Keycloak state and associated demo PVCs. It is not an in-place migration or a reversible rollback.
- Reuse existing operator secrets without exposing or rotating them. Recreate configured demo identities through the existing deployment workflow.
- Do not overwrite release tags. Do not bypass CI or artifact publication checks.
- Keep execution-capacity enforcement at its existing disabled default. Do not fold in unrelated application fixes.
- Publish before downtime: a failed build must leave the existing demo intact.
- Cluster teardown removes cert-manager state: inspect other certificate consumers before execution; unrelated consumers require narrower teardown or user direction.
- Avoid deployment races: check active workflows and hold the shared VM lease during teardown, releasing it before the deployment workflow acquires it.
- Fresh database state invalidates existing target agents and integrations. Preserve their installations but document re-enrollment/reconfiguration requirements.
- Ubuntu 24.04 is the qualified AgentV host. A passing systemd CI gate does not certify physical power-loss recovery or all distributions.

## 1. Establish release baseline

- [x] Verify clean product checkouts and compare HEAD with live remote main, not only cached origin/main. All 13 product/workspace/demo checkouts matched; remote master was absent.
- [x] Confirm successful main CI for all seven runtime components at their exact source revisions.
- [x] Compare published tags with source; AgentK and AgentV have no newer source to release.
- [x] Inspect demo VM and Kubernetes read-only. Existing demo uses platform chart 0.0.1-experimental.22; VM is Ubuntu 24.04 and node is Ready.
- [x] Run demo doctor and unconfirmed cluster teardown preview. Doctor passed; preview intentionally stopped without deleting anything.
- [x] Verify AgentV .6 installer, archive, checksums, SBOM and successful Ubuntu systemd release workflow.
- [x] User confirmed execution, explicitly preserving all local codebases and repositories from reset.

## 2. Publish application artifacts

Proposed coordinates, subject to a final uniqueness check:

| Component | New version | Source baseline |
| --- | --- | --- |
| Management Console | 0.0.1-experimental.37 | 78b1302a6a55cdbef2df53a80f7811cf9f71162e (history fix; replaces failed .36) |
| Platform Admin Console | 0.0.1-experimental.6 | d11b4bcf430018282744620619a05b544870d5b9 (version-only commit) |
| Control plane | 0.0.1-experimental.35 | bf24329069af1342da968c9f3bd653f746885fbf |
| Execution engine | 0.0.1-experimental.15 | 635f0a6b6c4f91b17d915e2e12c64b10d1dede3b |
| LLM gateway | 0.0.1-experimental.20 | 2bad4ed6f6339b440aab3c0c2212f7a9e4ff6ab2 |

- [x] Use shared branch slug `chore/demo-release-refresh` for metadata changes; leave untouched component branches alone.
- [x] Update root versions in platform-admin-console/package.json and package-lock.json, plus the existing explicit-version harness assertion. Its release workflow requires package/tag equality.
- [x] Run admin `ADMIN_CONSOLE_DATA_MODE=control-plane npm run validate`; 99 tests and all checks passed. Version commit `d11b4bcf430018282744620619a05b544870d5b9` is on main; CI run `40010442738` passed.
- [x] Publish unique version tags through existing workflows. All five releases succeeded, including replacement Management Console .37.
- [x] Resolve every published GHCR image manifest and record digest/source/run. OCI provenance matches each source baseline; unchanged AgentK .13 image/chart and AgentV .6 assets are available too.

## 3. Publish coordinated platform chart

Files: deployment `kubernetes/helm/acornops-platform/{Chart.yaml,values.yaml}`, `compose/vm-prod/compose.yaml`, `release/stack-versions.yaml`, and this release record.

- [x] Set platform chart 0.0.1-experimental.24, appVersion to control-plane .35, and pin the five new application images consistently. Keep AgentK .13 and AgentV .6.
- [x] Update current matrix compatibility notes to distinguish this release from historical AgentV minimum coordinates. Do not rewrite historical evidence.
- [x] Run deployment `task validate` and `task platform-contracts`. Both passed again with the final .37 pins.
- [x] Run published-artifact release-matrix checks (skip only the not-yet-published current platform chart during preflight). Passed after .37 publication.
- [x] Integrate metadata, publish the new chart tag, wait for chart/index workflows, then verify the full matrix including the published chart. Deployment commit `2f752a2`, release `40075030074`, CI `40075027568`, chart mirror `40075067688` and Pages deployment `40075079084` all passed; charts main is `78f18be`.

## 4. Reset and deploy the demo

Files: demo-infra `ansible/group_vars/demo/platform.yml` and an operations record. A push changing this pin file automatically starts deployment: do not push it before teardown is complete.

- [x] Prepare chart .24 and five new image pins; remove the obsolete rollout-retry comment. `task validate` passed with installed pipx Ansible on PATH and `ANSIBLE_SYNTAX_REQUIRED=true`; `task demo:secrets:validate` passed without uploading or exposing secrets.
- [x] Recheck VM identity, active deployments, shared lease, named PVCs and cluster-wide certificate consumers. Exact targets confirmed; no competing deployment was active.
- [x] Acquire the existing shared lease with a unique owner token and bounded wait.
- [x] Run `task demo:teardown:data DEMO_ENV_FILE=.env.demo -- --confirm` only after all artifacts are verified. Exit 0; all three platform/data/identity namespaces and old PVs verified absent. Mattermost container identities/health and certificates, k3d containers and shared cert-manager were preserved. No forced finalizer removal, host-wide cleanup or local reset.
- [x] Release the lease; integrate and push validated demo pins. Demo commit `69c12e6` triggered one deployment (`40076347341`); CI `40076347424` passed. No duplicate dispatch.
- [x] Run `task demo:verify DEMO_ENV_FILE=.env.demo`, `task demo:verify:public`, and read-only VM/Kubernetes checks. Both tasks passed. All five application pods were Ready with zero restarts and image IDs matching the verified OCI index digests. Public/internal certificates were Ready; chart .24 is deployed at Helm revision 1.
- [x] Verify browser sign-in entry points: Management Console rendered its SSO-only screen and redirected to the control-plane OIDC client; Platform Admin Console redirected to its separate admin OIDC client. Both reached the expected Keycloak form over trusted HTTPS. Signed-in workspace/VM onboarding is explicitly deferred to the user's test; no credentials were exposed, agent installed or paid-model call made.
- [x] Record exact mutations, deletion/recovery boundary, release coordinates, checks, failures and remaining acceptance gates. The 13 relevant workspace/product/demo main branches matched live remote main; pre-existing untracked workspace `tmp/` evidence was retained. The final documentation commit is separate from the immutable chart release commit.

## 5. Real-VM handoff

- [x] Document prerequisites: Ubuntu 24.04/systemd, sudo, Node >=22 at /usr/bin/node, curl and trusted outbound HTTPS/WebSocket access to api.demo.acornops.dev. No inbound agent port is needed.
- [x] Document console path: workspace → Virtual machines → Connect VM; enter name and select Read-only or Read-write. Read-write requires exact restartable .service names and remains bounded by run/approval policy.
- [x] Document running only the generated version-pinned command on the intended VM. Its target-bound enrollment token is single-use and expires in 15 minutes; never paste it into chat or docs.
- [x] Document user-side verification of online status/telemetry, `sudo acornops-agentv-doctor` and `sudo journalctl -u acornops-agentv -n 100 --no-pager`. These target-host checks await the user's installation.
- [x] Document read-only diagnostics first and write tests only against deliberately chosen noncritical services; no restarts of SSH, networking, k3s, Docker or platform dependencies on the demo host.
- [x] Document fresh registration for existing Kubernetes agents, and reconfiguration of AI/MCP credentials and workspace-bound integrations, even though the separate k3d/Mattermost installations were preserved. Guide: private demo-infra `docs/demo-vm-onboarding.md`, commit `69c12e6`.

## Evidence and remaining boundaries

Main CI is green for all runtime source baselines; this is release eligibility, not new deployment acceptance. AgentV release run 31323695762 passed at f2c216061bc86ab6a859e229344450097d5389b0. Plan preparation itself made no live changes; execution progress follows.

Release workflow IDs: original management-console `40009902321`, replacement management-console `40072900387`, control-plane `40009908597`, execution-engine `40009915431`, llm-gateway `40009921347`, platform-admin-console `40010659820`. All five selected images are published. Original Management Console .36 failed its browser gate; its tag remains unchanged and no .36 image was published. The coordinated chart uses verified .37 instead.

Verified OCI index digests:

- management-console .37: `sha256:6e9717f9daf851fd0082a7fd078c86c702dc2fb72b1814f6363448ad16b67961`
- platform chart .24: `sha256:f1216ac9e899e7c6d412daa847843e3642dbd6ba7ec871fbab7b290c18bedf40`
- control-plane .35: `sha256:5a82b169a14838d0d4ae95b296cd6e677bd33cff2e69e55fe4c03e838d4ecea4`
- execution-engine .15: `sha256:4b2a7dcbe8992d50ec0cdf8a80ec1f8a341404596e8ade8d09e4f4ee18829362`
- llm-gateway .20: `sha256:f0d805f7cf16cb5dea903a01044a76114d2627a3376ec5243f00c3272ae75efb`
- platform-admin-console .6: `sha256:906c5fb7f70453fa9cd891ab093dac6582e4af993a863641bbfcfd45446fbaaa`
- unchanged AgentK .13 image: `sha256:a6d6f6d1582d767c431b65a3bcfdfc929ecc59f7449b4e23ff2d40e5d4d28557`
- unchanged AgentK .13 chart: `sha256:d45b29daa4c0e12d7f151a8e450f5dec0aa4759a3278403e1250adb616daec91`

Independent metadata review found no blocking defects. Deployment `task validate`, `task platform-contracts` and the full published-artifact matrix passed. Admin's first validation attempt failed because sandbox loopback binds were denied; after enabling the test environment, the existing explicit-version assertion also required .5 → .6. The final full rerun passed. Initial metadata preparation did not change application logic; the subsequently authorized console fix is recorded below.

### Release blocker: settings history navigation

Management Console release run `40009902321` passed preflight and preceding design checks, then failed `tests/fixtures/ui-polish-accessibility.spec.ts:61`, “settings destinations remain links with current-page and history semantics.” The fixture suite reported 252 passed and 1 failed. After browser Back, the URL was `/workspaces/fixture-workspace/settings`, but the Members page and selected link persisted; the Workspace link did not regain `aria-current="page"` within 20 seconds. Subsequent MCP parity and image publication steps did not run.

The unchanged test initially passed 12 repeated local runs on isolated port 4196. Subsequent deterministic reproduction confirmed a race between SettingsPage's immediate local `activeTab` update and the router's transitional `initialTab` prop: a rapid Back can return to the original route without changing that prop, leaving local tab state stale.

Execution paused for approval before expanding the metadata-only plan into a focused application fix. The test was not bypassed and the existing .36 tag was not moved. No remote reset, database deletion, deployment, host runtime installation, or local repository reset had been performed at that checkpoint.

User authorized the focused navigation diagnosis/fix and subsequent release/reset on 2026-10-24. Resume Task 2 with this bounded addition:

- [x] Reproduce rapid Back during a settings-tab transition in `management-console/tests/fixtures/ui-polish-accessibility.spec.ts`; assert URL, active link and displayed tab agree, then verify Forward. Failed 4/4 before the fix; original/new tests passed 12/12 afterward.
- [x] Fix the conflicting route/local selection state in `src/pages/SettingsPage.tsx`, preserving permissions, real links and presentation. No router-wide rewrite or unrelated UI changes. Commit `78b1302a6a55cdbef2df53a80f7811cf9f71162e` is on main; local validation passed with 1187 tests, and 43 focused browser tests passed. Browser-tool checks confirmed all three settings destinations and Back/Forward. Independent review found no blocking defects.
- [x] Run the regression red/green, settings/accessibility fixture coverage, `npm run validate` and release browser validation. Document the navigation invariant and obtain a fresh focused code review before integration. Main CI passed all jobs, including 254 fixture tests, 27 snapshots (one pre-existing skip), 8 MCP parity tests and all route projects. The replacement tag's validation job also passed; image publication follows separately.
- [x] Integrate the reviewed fix and publish a new unique console tag (.37, verified unused). Release and provenance verification passed before chart publication or demo reset.

Replacement release `40072900387` and main CI `40072897671` both passed at exact commit `78b1302a6a55cdbef2df53a80f7811cf9f71162e`; the .37 tag was verified unused before publication. Local main and remote main match. The old .36 tag is unchanged.

Existing production gates (real cross-service VM acceptance, physical reboot recovery, staging remediation runs/soak) are not waived by this demo refresh.

## Live outcome and recovery boundary

Demo deployment `40076347341` succeeded at `69c12e6e141b66a3d01ff60419a974787fb3d390`; its CI also passed. Three fresh PVC UIDs were verified different from the deleted volumes. The four Mattermost containers and four workload-cluster containers retained their original identities and remained healthy/running. Shared cert-manager was reconciled at its existing v1.21.0 version, not removed. The deployment lease was released normally.

The authorized command was exactly `task demo:teardown:data DEMO_ENV_FILE=.env.demo -- --confirm`, under the existing shared lease. It deleted the `acornops`, `acornops-data` and `acornops-identity` namespaces, their Helm releases and three old PVCs/PVs. No backup was created for this requested fresh reset. Old workspaces, stored credentials, registrations and identity state cannot be restored through the normal application flow; any separate external backup is outside this work. Operator secrets were reused, not rotated or exposed. No local repository reset, local Docker teardown, host runtime installation or unrelated service deletion occurred.

Validation commands observed passing:

- Management Console: `npm run validate`; repeated original/new history tests (12/12); `FIXTURE_APP_PORT=4196 npm run smoke:fixtures -- ui-polish-accessibility.spec.ts permission-profiles.spec.ts responsive-navigation.spec.ts workspace-access-selection.spec.ts --workers=2` (43/43); full post-merge `npm test` (1187/1187). The new regression failed 4/4 before the fix.
- Platform Admin Console: `ADMIN_CONSOLE_DATA_MODE=control-plane npm run validate` (99 tests and all gates).
- Deployment: `task validate`, `task platform-contracts`, and `ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true node scripts/check-release-matrix.mjs` including the published chart.
- Demo: `ANSIBLE_SYNTAX_REQUIRED=true task validate` with installed Ansible on PATH; `task demo:secrets:validate DEMO_ENV_FILE=.env.demo`; `task demo:verify DEMO_ENV_FILE=.env.demo`; `task demo:verify:public`.
- Browser: local settings Workspace/Members/AI navigation plus Back/Forward; live Management/Admin Console OIDC sign-in redirects. No authenticated live onboarding or target-host install was performed.

## Execution decisions and deferred review polish

- Reused existing checkouts/feature branches per the user's preference; no new worktree or local reset. Risk: metadata could appear on an unexpected branch; changed checkouts returned to main.
- Used metadata/version assertions for release-only work instead of synthetic application tests. Risk: artifact mismatch; published manifests/provenance and the matrix were verified. The later application fix received its own red/green regression.
- Used data teardown, not cluster teardown, because Mattermost shares cert-manager. Shared certificate infrastructure intentionally survives; no demo application/identity database survives in it.
- Amended the approved plan for the explicitly authorized history fix instead of restarting planning. Risk: accidental scope expansion; the fix remained five files with no router-wide, style or API changes.
- The focused reviewer did not run test processes or certify registry/live behavior. Executor-observed exit statuses, artifact checks and live verification supplied those gates; wider UI/permission audits remain outside this fix. Risk: unrelated pre-existing defects are not certified away.
- Prepared .37 pins before image publication only for local validation; held chart publication and downtime until verification passed. Risk: temporary unavailable references in uncommitted files, never deployed.
- Limited live browser acceptance to sign-in redirects, leaving authenticated onboarding and agent installation to the user's requested VM test. Risk: signed-in or target-specific failures may still surface; no end-to-end VM success is claimed.
- Deferred minor: optionally add an explicit Members `aria-current` assertion after Forward in the new rapid-Back regression. URL/display are already asserted, and manual browser verification confirmed the link state; no blocking defect was found.
