# Production AgentV Version Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or the implementation method selected by the user. Steps use checkboxes for tracking. The user authorized M3 implementation on 2026-10-30. Chart publication, deployment, and installed-agent upgrades are separate release operations.

**Status:** Source implementation and local validation complete on `fix/token-cap-and-agentv-defaults`; independent review passed with no findings. No chart publication or host upgrade.

**Goal:** Make bundled Helm examples generate AgentV enrollment commands for the selected stack's pinned version, while preserving deliberate operator overrides and private release mirrors.

**Architecture:** Remove redundant AgentV version pins from repository-owned examples so they inherit the chart's release-matrix-checked default. Extend effective-render validation across every example and representative combined values files. Keep compatibility checks about repository release assets separate from runtime support for explicit operator version/mirror choices.

**Tech Stack:** Helm (locally validated with 4.1.3), YAML/chart schema, Node.js built-in tests, Docker Compose rendering, existing Task release checks.

**Spec:** User-requested 2026-10-30 remediation planning for the stale production AgentV example. Baseline sources are `release/stack-versions.yaml`, chart `values.yaml`, `scripts/check-release-matrix.mjs`, and the observed production render; acceptance criteria are recorded below.

**Priority:** P2. **Complexity:** Small–medium; 1–2 engineer-days including regressions, release coordination and verification. No AgentV runtime change is included.

## Global Constraints

- Source changes are authorized; do not install agents or contact the demo VM.
- Use `/Users/tjtanjin/Desktop/acornops/acornops-workspace/acornops-deployment`, not an alternate checkout.
- Baseline matrix on 2026-10-30: platform chart `.30`, control plane `.42`, execution engine `.18`, gateway `.22`, management console `.45`, AgentK chart `.15`, AgentV `.13` (all `0.0.1-experimental.*`).
- Read the current matrix again at implementation time; tests derive expected versions from it rather than freezing today's `.13` forever.
- Preserve intentional user `targetAgents.agentv.systemd.version` and HTTPS `releaseBaseUrl` overrides; do not add runtime enforcement that all users must select the public matrix version.
- Preserve `examples/values-air-gapped-catalog.yaml`'s internal mirror URL and existing private-CA/catalog behavior.
- Existing installed AgentV services are unaffected by generated onboarding defaults; their upgrade remains an explicit supported host operation.
- Do not change application images, AgentK pin policy, schema epoch, execution contract, or unrelated certificate plan/index edits.

## Review Focus

- Production example: effective rendering inherits the matrix version instead of silently retaining `.6` (Tasks 1–2).
- Air-gapped example: inherited version changes while the private mirror URL remains effective (Tasks 1–2).
- Layered values: production plus mirror configuration still resolves to one coherent version and mirror (Task 2).
- Explicit overrides: valid operator version and mirror values win in either example; invalid mutable versions retain existing rejection (Task 2).
- Publication/install boundaries: source/example correction does not overwrite an existing immutable chart release or upgrade installed agents (Task 3).

## Evidence and File Map

Paths are relative to this deployment repository unless explicitly prefixed `../`.

| File | Responsibility |
| --- | --- |
| `release/stack-versions.yaml` | Expected VM/Kubernetes AgentV version and coherent platform chart/image matrix. |
| `kubernetes/helm/acornops-platform/values.yaml` | Single default `targetAgents.agentv.systemd.version`, currently `.13`. |
| `kubernetes/helm/acornops-platform/examples/values-production.yaml` | Remove stale `.6` override; preserve other production settings. |
| `kubernetes/helm/acornops-platform/examples/values-air-gapped-catalog.yaml` | Remove stale `.6` override; preserve internal `releaseBaseUrl`. |
| All `kubernetes/helm/acornops-platform/examples/*.yaml` | Automatically enumerate and check effective generated AgentV version. |
| `scripts/check-release-matrix.mjs` | Add matrix-based effective example assertions and useful diagnostics. |
| `scripts/check-release-matrix.test.mjs` | Test validation acceptance and drift rejection without mutating checked-out files. |
| `scripts/lib/release-matrix-agentv.mjs` and `.test.mjs` | Pure effective-version assertion and focused matching/drift tests. |
| `scripts/check-kubernetes-platform-chart.mjs` | Retain existing schema/policy tests; add override/mirror render coverage where appropriate. |
| `Taskfile.yml` | Include focused helper tests in the existing release-matrix validation task. |
| Chart `Chart.yaml`, matrix, `docs/OPERATIONS.md` | Change only as required for an authorized new chart release; preserve appVersion semantics. |
| Active plan index and this plan | Status, evidence and remaining release/installation gates. |

Baseline reproduction: from this repository, `helm template assessment kubernetes/helm/acornops-platform --namespace assessment -f kubernetes/helm/acornops-platform/examples/values-production.yaml` renders `AGENTV_SYSTEMD_RELEASE_VERSION: "0.0.1-experimental.6"`.

The same stale explicit `.6` pin exists in the air-gapped example. Existing release checking verifies the default chart's `.13`, so the source can currently pass while these examples drift.

## Decision: Inherit Rather Than Repeat

Selected: remove `version` from both repository examples and add a short comment that the chart inherits the release-matrix default; retain mirror overrides only where they serve a purpose.

Alternative: change every explicit example pin to `.13` and require synchronization on each release. That makes examples self-contained but creates duplicate version-maintenance points; it does not improve effective chart reproducibility because the installed chart is already versioned. Use explicit pins in operator-owned values when required, not as redundant defaults in these examples.

No change to the chart value/schema's override capability is intended. Do not reject a valid operator-specified version merely because it differs from the repository's release matrix.

## Task 1: Correct Both Bundled Examples

**Files:** `examples/values-production.yaml`, `examples/values-air-gapped-catalog.yaml`, and relevant operator notes under `docs/OPERATIONS.md` if needed.

**Interfaces:** Consumes chart default + selected matrix; produces example values that inherit the correct version and keep explicitly configured mirror routing.

- [x] Read current `AGENTS.md`, deployment-safety guidance and matrix; record repository status before changing source.
- [x] Reproduce both stale example renders and record the default chart AgentV version for comparison; use `helm template` only.
- [x] Remove the two redundant `targetAgents.agentv.systemd.version` keys, leaving the air-gapped `releaseBaseUrl` and all unrelated values unchanged.
- [x] Document inheritance beside the example section and distinguish generated onboarding settings from installed-agent upgrades.
- [x] Render default, production, air-gapped and production-plus-air-gapped configurations; expect exactly one effective AgentV version equal to the matrix.
- [x] Confirm mirror rendering still uses `https://artifacts.internal.example/acornops/agentv` and public production still uses the public release source.

Expected output: the default and all bundled examples select the coherent baseline agent release; neither existing host services nor enrolled credentials are touched.

## Task 2: Make Effective Version Drift Fail Validation

**Files:** `scripts/check-release-matrix.mjs`, `scripts/check-release-matrix.test.mjs`, `scripts/check-kubernetes-platform-chart.mjs`.

**Interfaces:** Add exported pure `agentVExampleFailures(rendered: string, expectedVersion: string, label: string): string[]` in `scripts/lib/release-matrix-agentv.mjs`; the CLI renders and accumulates failures, while Node tests exercise the same parser/contract.

- [x] Create `scripts/lib/release-matrix-agentv.mjs` and `scripts/lib/release-matrix-agentv.test.mjs`; no third-party YAML package is required for the one generated ConfigMap key.
- [x] Write failing tests: matrix match returns `[]`; stale `.6`, missing value, empty value, and duplicate/conflicting generated version entries return labeled failures.
- [x] Accept indentation and YAML quoted/unquoted scalar forms used by Helm; match the exact `AGENTV_SYSTEMD_RELEASE_VERSION` key rather than incidental version strings elsewhere.
- [x] Implement the pure helper and run `node --test scripts/lib/release-matrix-agentv.test.mjs`; expect all cases pass.
- [x] Enumerate sorted `examples/*.yaml` using `readdirSync`, matching the chart checker convention, and render each using the exact same chart/release namespace as the default release check.
- [x] Feed each render through the helper with the matrix-derived version; include filename, expected version and actual/missing values in failure messages.
- [x] Add production plus air-gapped combined rendering in documented order; assert expected version and mirror URL independently.
- [x] Keep explicit override acceptance outside bundled-default assertions: render production and air-gapped examples with `--set-string targetAgents.agentv.systemd.version=1.2.3` and verify `1.2.3` wins.
- [x] Preserve the existing private mirror/version override test and schema failures for mutable/non-semver versions or unsafe release URLs; add targeted cases only where current coverage is absent.
- [x] Wire the helper test into `task release-matrix-check` alongside `scripts/check-release-matrix.test.mjs`; this also brings it under ordinary `task validate` and CI.
- [x] Verify negative integration behavior through the full release CLI with a temporary fixture containing an additional stale example. Copy only required public fixtures, not local operator environment files; expect a nonzero exit and filename/expected/actual diagnostics. Never edit/revert the real checkout to simulate failure.
- [x] Confirm default application/migration image assertions and VM Compose AgentV checks remain intact; the new loop adds coverage rather than replacing existing matrix checks.

Expected output: a future stale pin in any bundled example fails release validation; deliberate operator override rendering remains supported. No published asset lookup is required for offline tests.

## Task 3: Verify and Prepare an Immutable Release

**Files:** Existing validation/metadata paths from the file map, plus this plan/index evidence.

**Interfaces:** Consumes corrected examples and regression checks; produces validation evidence and a release decision without publishing during this planning task.

- [x] Run `node --test scripts/lib/release-matrix-agentv.test.mjs scripts/check-release-matrix.test.mjs` and `task release-matrix-check`; expect helper/drift tests and matrix checks pass.
- [x] Run `task k8s-chart-check`, `task contracts:check`, `task harness:check`, `task validate`, and workspace `task validate`; expect existing image, migration, edge and drain tests remain green.
- [x] Run `git diff --check`; inspect effective renders and a diff limited to examples, focused tests/checkers and necessary notes/metadata.
- [x] Classify the artifact change before release: examples under the chart directory are packaged content. Do not replace the published `.30` archive or reuse its immutable OCI tag.
- [ ] For a chart publication, select the next unused approved experimental chart version after checking actual registry/repository history; do not assume `.31` is free.
- [ ] Update `Chart.yaml.version` and `k8s-platform-v1.chart.acornopsPlatform` together; retain `Chart.yaml.appVersion` tracking the unchanged control-plane image version, preserve all runtime image/agent pins, and update matrix date/release note.
- [ ] Run `ACORNOPS_RELEASE_VERSION=<approved-version> ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=false node scripts/check-release-matrix.mjs` for the proposed release; expect tag/matrix consistency.
- [ ] Before authorized release, run the existing published-artifact preflight with `ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true` and `ACORNOPS_SKIP_CURRENT_PLATFORM_CHART_ARTIFACT=true`; require all pinned images, AgentK chart and AgentV assets to exist.
- [ ] Let the existing release-chart workflow publish OCI and notify the classic chart mirror only after release approval; this plan does not trigger either workflow.
- [ ] Verify a downloaded new chart package contains corrected examples and renders the intended version; verify the mirror checksum/index points to that immutable package.
- [x] Record that existing operator files with an explicit `.6` override remain explicit overrides: operators must remove/update them after compatibility review; chart defaults cannot silently override user values.
- [x] Leave installed AgentV upgrade and live host verification as separate explicitly authorized operations, not an automatic consequence of this correction.

## Acceptance and Rollback

- [x] Default, every bundled example, and production-plus-mirror renders use the selected matrix AgentV version without duplicate/conflicting entries.
- [x] Public and mirrored release URLs remain correct; operator overrides still render their selected valid version.
- [x] The release checker invokes the tested effective-render assertion for every example; the temporary stale example produces a drift failure, while platform/VM image-matrix checks and schema protections continue to pass.
- [ ] The release uses a new immutable chart version if packaged content is published; unchanged binaries keep their existing image versions.

Rollback before publication is a source revert. After publication, publish a corrected successor rather than overwriting a chart tag. If a newly generated enrollment command has not run, issue a corrected command; if it has run, use AgentV's separately reviewed upgrade/rollback procedure. Reverting platform values does not downgrade an installed agent.

## Estimate and Handoff

Allow 0.25 day for examples and ownership notes, 0.5–1 day for parser/render regressions and full validation, and 0.25–0.75 day for release review/package verification: **1–2 engineer-days**, excluding release queues and optional live-host acceptance.

Handoff records actual matrix/chart version, changed files, commands and outcomes, every example tested, override tests, publication/mirror status and installed-agent scope. Current status: **source implementation and validation complete; independent review passed; publication and host upgrades unstarted**.


## Implementation evidence — 2026-10-30

- Removed only the two redundant `.6` version overrides; all eight bundled examples now render exactly one `0.0.1-experimental.13` AgentV install version inherited from chart defaults and the current matrix.
- The production-plus-air-gapped render retains its private release mirror. Explicit version `1.2.3` and an operator HTTPS mirror override the layered examples; existing default/VM/application-image checks remain in place.
- RED: the original CLI incorrectly accepted an additional stale example. After adding the guard, it rejected both existing stale examples and their layered render. Removing the two pins made the checks pass. The permanent test creates/removes an isolated fixture and verifies full-CLI failure for future stale examples.
- `task release-matrix-check`: **13 tests passed**, followed by matrix validation. Pure helper checks cover exact-key matching, quoted/unquoted values, empty/missing, stale, duplicate, and conflicting values.
- `task validate` passed, including chart/schema checks, **30 drain checks**, release matrix, production edge/images, and all Compose examples. Initial sandbox loopback denial affected two existing ingress tests; the permitted loopback rerun passed. `task platform-contracts` and workspace `task validate` also passed.
- No chart/image versions or release matrix changed. Packaged examples require a newly allocated immutable chart version when publishing; do not replace the published `.30` artifact. Registry existence/package/mirror verification and installed-host upgrades are pending release work.

### Implementation rulings

1. Implement the drift test/guard before correcting the examples, so RED evidence proves both the missing validation and the stale defaults.
2. Use the full CLI for the temporary-fixture negative test instead of testing only helper output. This adds modest render cost but verifies enumeration and the failure exit status together; copy only required public inputs to avoid duplicating operator files.
3. Retain the tiny pure scalar helper and reuse existing override renders. Add only missing invalid version/URL cases to the chart checker; no YAML dependency or runtime override restriction.
4. Use the same dedicated branch in the existing child checkout after the app's earlier nested-worktree limitation. Explicit staging must preserve the unrelated certificate plan and its index entry.
5. Defer publication/version allocation and live upgrades. This avoids reusing an immutable tag; users of the old published package need the later release before benefiting from the corrected examples.


### Final review — 2026-10-30

A fresh reviewer found no Critical, Important, or Minor issues and judged the
source ready to merge. It independently ran all 13 release tests and rendered
production and air-gapped examples with default and explicit version/mirror
settings. No deferred minor findings.

The executor accepted the review's scope rulings: the narrow helper validates
exactly the scalar emitted by this chart, so a general YAML parser is unnecessary;
published `.30` contents remain unchanged until an immutable successor is released;
operator-owned pins and installed hosts intentionally remain independent. The
costs are deliberate: fixture parsing must track future template changes, existing
operator pins need explicit maintenance, and deployment acceptance cannot be
inferred from offline renders. M2, earlier H fixes, and unrelated certificate work
remain outside this change.
