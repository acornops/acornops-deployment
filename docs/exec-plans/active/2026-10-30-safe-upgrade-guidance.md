# Safe Upgrade Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or the implementation method selected by the user. The user authorized implementation on 2026-10-30. Publication and live upgrade qualification remain separate release work.

**Status:** Documentation implementation and local validation complete on `fix/high-priority-defects` in deployment and docs-website. Public publication acceptance remains open. The implementation record supersedes the original proposed semantic-check task below.

## Implementation record — 2026-10-30

- [x] Updated deployment `docs/vm-production.md` and public operations, deployment-reference, VM Compose and production-readiness pages. Canonical `docs/OPERATIONS.md` was already correct and remains unchanged.
- [x] All entry points distinguish fresh empty databases, verified earlier epoch with explicit discard approval, preserving matching greenfield upgrades, and unknown/divergent history that requires stopping.
- [x] Removed unconditional reset instructions; documented existing writers, database/secret backups and restoration, coordinated release boundaries and incompatible rollback.
- [x] Independent review found that earlier setup steps could still overwrite the environment before the reader reached upgrade guidance. Template copying and secret generation are now explicitly fresh-install-only; upgrades preserve existing files and keys.
- [x] `docs-website`: `npm run check`, `npm run validate`, `npm run links` passed. `acornops-deployment`: `task contracts:check`, `task validate` passed. Four-state scenarios and direct-entry setup were reviewed against the canonical runbook.

**Critical plan adjustment:** Do not add heading/phrase regex checks for human prose. Existing structural/build/link/contract checks plus scenario review are proportionate; brittle wording tests would increase maintenance without proving operational safety. The cost is that future semantic drift still needs human review. No infrastructure code, migration or release pin changed.

**Workspace ruling:** The native worktree tool rejected nested child repositories. Dedicated branches in the existing checkouts preserve unrelated planning edits; explicit file and partial-index staging prevent those edits entering the fix. One shared branch slug follows workspace policy, with separate commits per defect; the two control-plane fixes share a branch.

**Remaining release work:** Publish the corrected pages and inspect the public versions. No existing installation was upgraded, reset or restored by this documentation change; real backup/restore rehearsal remains an operator release gate.

## Original proposed plan

The remaining unchecked tasks preserve the original proposal and are superseded where the implementation record narrows scope.

**Goal:** Make every operator entry point preserve ordinary existing greenfield installations and reserve destructive reset for a verified earlier schema epoch with explicit approval.

**Architecture:** Keep deployment `docs/OPERATIONS.md` as the detailed operational source of truth. Publish a concise equivalent decision table in the public operations page, and turn other deployment entry points into summaries linking to that procedure. Add small semantic assertions to existing documentation/contract checks; do not introduce runtime behavior or a documentation-generation framework.

**Tech Stack:** Markdown, Mintlify MDX, existing Node.js structural checks, Task.

**Spec:** User-requested 2026-10-30 remediation planning for the confirmed destructive-upgrade documentation defect. The requirements and acceptance criteria are recorded in this plan; baseline procedure is `docs/OPERATIONS.md#installation-and-upgrade-paths` and `release/stack-versions.yaml`.

**Priority:** P1. **Complexity:** Small–medium; 1–2 engineer-days including review, semantic checks and rendered documentation validation. No migration engineering is included.

## Global Constraints

- Planning changes only until implementation is separately authorized.
- The canonical workspace is `/Users/tjtanjin/Desktop/acornops/acornops-workspace`; do not use the alternate `hosted-readiness` checkout.
- Existing `greenfield-1` history with matching checksums uses pending forward migrations, preserving both databases and secrets.
- Unknown history, missing history on non-empty databases, checksum drift, divergent revisions, and a database ahead of selected binaries require stopping and investigation.
- Reset requires a verified earlier epoch and explicit operator approval to discard its data; schema epoch is not an instruction to wipe installations.
- No commands in this work may mutate a database, secret store, VM, Kubernetes cluster, or running application.
- Preserve unrelated certificate-plan and active-index edits; no image, chart, API, migration, or schema-contract change is required.

## Review Focus

- Existing greenfield data: the normal upgrade path preserves data and applies pending migrations (Task 1 table and Task 2 checks).
- Unknown or divergent history: the procedure stops rather than guessing a version range or authorizing a reset (Tasks 1–2).
- MCP credential boundary: readers find coordinated quiescence, both database backups and the gateway secret namespace (Task 1 cross-links).
- Fresh installation: two empty databases require migration jobs and startup, without invented reset or credential cleanup (Tasks 1–2).
- Older binaries and rollback: schema compatibility and first-drain-cutover requirements remain distinct from ordinary image replacement (Tasks 1 and 3).

## Evidence and File Map

All paths below are relative to the canonical workspace, unless marked otherwise.

| File | Responsibility / present defect |
| --- | --- |
| `acornops-deployment/docs/OPERATIONS.md` | Existing correct four-state procedure, checksum checks, MCP maintenance and restore boundary; preserve its substance and stable anchors. |
| `acornops-deployment/docs/vm-production.md` | Remove unconditional drop/recreate instructions and the misleading claim that `prod-up` prevents already-running writers. |
| `docs-website/deploy/operations.mdx` | Replace blanket reset upgrade flow with public four-state decision table and operational boundaries. |
| `docs-website/deploy/deployment-reference.mdx` | Replace unconditional greenfield reset paragraph with a link and state-based summary. |
| `docs-website/deploy/vm-compose.mdx` | Replace ambiguous epoch-only upgrade wording with the same preserve/stop/reset distinction. |
| `docs-website/deploy/production-readiness.mdx` | Ensure release evidence includes verified migration history and a tested database/secret recovery boundary. |
| `docs-website/scripts/check-docs.mjs` | Public-page semantic guard, using its existing assertion mechanism. |
| `acornops-deployment/scripts/check-contracts.mjs` | Deployment-guide semantic guard, using its existing failure collection. |
| This plan and `acornops-deployment/docs/exec-plans/active/README.md` | Record status, evidence, remaining publication acceptance. |

## Required Decision Table

Use these four decisions in public operations; retain the fuller canonical deployment table.

| Starting state | Operator action | Reset allowed? |
| --- | --- | --- |
| Fresh installation: both application databases empty | Select the pinned matrix, configure secrets, run matching migrations, verify readiness. | No reset needed. |
| Verified pre-`greenfield-1` schema | Stop writers, obtain explicit approval to discard data, back up and verify restoration, follow the scoped reset procedure or plan a separate data migration. | Only with that verification and approval. |
| Existing `greenfield-1` with matching recorded migrations | Preserve both databases and secrets; apply pending forward migrations using selected images. Follow applicable coordinated boundaries. | No. |
| Unknown epoch/history, checksum drift, divergent ancestry, or database ahead of selected images | Stop; reconcile provenance and rehearse a supported path before proceeding. | No inferred permission. |

The public guide must not imply that a backup alone authorizes destruction or that all pre-release data is disposable.

## Task 1: Align Operator Procedures

**Files:** Documentation rows in the file map above. No runtime source changes.

**Interfaces:** Consumes canonical migration-history and release-matrix procedures; produces consistent operator decisions and stable links usable by every install guide.

- [ ] Read both repositories' `AGENTS.md`, deployment safety guidance, current release notes, and canonical maintenance/rollback sections before editing.
- [ ] Record the current destructive passages at public operations lines 13–24, public reference lines 227–230, and VM production lines 61–81; use headings rather than line numbers when editing.
- [ ] Write the four-state public table and link to the canonical `OPERATIONS.md#installation-and-upgrade-paths` GitHub URL for detailed provenance checks.
- [ ] Replace VM/reference entry-point reset recipes with state selection and a link; keep any destructive recipe only inside the explicitly titled pre-greenfield reset procedure.
- [ ] State that `prod-up` and Helm pre-upgrade hooks run migrations but do not stop existing writers; migration ordering alone is not quiescence.
- [ ] Preserve maintenance scope: close admission/scheduling, drain work, stop incompatible writers, back up both application databases and the matching gateway secret namespace, verify restore, inventory old image digests and configuration.
- [ ] Link the MCP boundary (`006`, `b20058629f4b` / `c3006973a8d2`), hosted-readiness activation, and first graceful-drain cutover to their current runbooks rather than duplicating long procedures.
- [ ] Explain that incompatible rollback requires the matching database/secret generation and pinned image set; restoring old applications alone is insufficient.
- [ ] Update the readiness checklist with the recorded starting state, representative restore rehearsal and rollback boundary; do not claim those gates have been run by this docs change.
- [ ] Review every affected page as an operator arriving directly from search, without having read another page.

Expected output: each entry point routes to one correct action for all four starting states; no ordinary-upgrade section tells operators to delete databases or run `local-reset`.

## Task 2: Add Proportional Semantic Drift Guards

**Files:** Existing `docs-website/scripts/check-docs.mjs` and deployment `scripts/check-contracts.mjs`.

**Interfaces:** Repository-local Markdown/MDX text goes into existing assertions; a violation adds a filename-specific failure and exits nonzero. No new package or shared runtime library.

- [ ] Add a small heading-scoped check inside each existing script; use normalized whitespace and case-insensitive semantic patterns, not whole-page snapshots.
- [ ] For public operations and canonical operations, assert the four state rows exist and associate fresh with empty databases, existing greenfield with preservation/forward migration, earlier epoch with explicit approval, and unknown/divergent history with stop/reconcile.
- [ ] For VM production, public reference and VM Compose summaries, assert the intended canonical/public operations link exists and the existing-greenfield preserve distinction remains visible.
- [ ] Scope destructive-command rejection to ordinary deploy/upgrade sections: fail on fenced `dropdb`, `DROP DATABASE`, volume deletion, or `task local-reset` there; allow these only in an explicitly named earlier-epoch reset section.
- [ ] Reject the known unsafe unconditional claims, including “Back up if needed, then drop” and “This is a first-install/reset cutover” when describing all installations.
- [ ] Require both database and secret-namespace recovery language or a direct maintenance-runbook link in the detailed upgrade procedure.
- [ ] Keep local-development reset documentation elsewhere valid; do not globally ban the word `reset` or treat historical plans as current operator instructions.
- [ ] Verify guards against temporary in-memory/copy fixtures: restore the old public reset paragraph, remove the unknown-history row, replace preserve with reset, and remove the detailed-runbook link; each must fail with its file/reason.
- [ ] Verify harmless heading/prose reflow passes, and the conditional earlier-epoch reset section remains permitted.
- [ ] Run `node scripts/check-contracts.mjs` in deployment and `npm run check` in docs; record positive and negative-check results.

Expected output: narrow executable evidence against destructive drift, with human review still responsible for semantics; no runtime tests or stack startup added for this docs-only fix.

## Task 3: Validate, Stage and Publish the Correction

**Files:** Same documentation and checker files; plan/index evidence only after validation.

**Interfaces:** Consumes Task 1 content and Task 2 checks; produces reviewable coordinated documentation changes and publication evidence.

- [ ] Run deployment `task contracts:check`, `task harness:check`, `task validate`; no stack startup is needed.
- [ ] Run docs `npm run check`, `npm run validate`, `npm run links`; expect structural checks, Mintlify build and link validation to pass.
- [ ] Run workspace `task validate` to verify repository/harness coherence; inspect `git diff --check` in each changed repository.
- [ ] If Mintlify is sandbox-blocked by its `~/.mintlify` cache, record the environment limitation and rerun in a permitted CI/preview environment; do not call the build accepted without a passing result.
- [ ] Preview the affected public pages and verify the four-state table, external canonical anchors, maintenance links and local navigation are readable and correct.
- [ ] Stage separate deployment/docs PRs under one descriptive branch slug, with related PR links, validation evidence and merge order; no PR creation is part of this planning task.
- [ ] Publish deployment source-of-truth correction first if changed, then publish public docs; public pages can safely link to the already-correct canonical procedure during the interval.
- [ ] Inspect the published pages after the normal docs pipeline completes; confirm no cached/operator entry point still gives blanket reset advice.
- [ ] Move this plan to completed only when code/doc checks and publication acceptance finish; leave any unavailable preview/publication gate explicit.

## Acceptance and Rollback

- [ ] An existing matching greenfield installation reaches forward migration without any deletion instruction; fresh, earlier-epoch and unknown-history scenarios produce their specified decisions.
- [ ] Backups cover both databases and the required secret namespace; approval, provenance and restoration checks precede the conditional destructive path.
- [ ] Published pages and repository guides agree; no database, secret, application or infrastructure changes occurred during this work.
- [ ] All applicable semantic/build/link checks pass and exact skipped checks are recorded.

Rollback is editorial: correct or revert a bad paragraph/check without restoring known-dangerous blanket reset guidance. There is no application, schema, or data rollback because this change performs no data mutation.

## Estimate and Handoff

The work has no API or database-schema dependency and can be reviewed independently from the AgentV example correction.

Allow 0.5 day for procedure/page alignment, 0.25–0.5 day for semantic guards and negative checks, and 0.25–1 day for cross-repository review, preview and publication evidence: **1–2 engineer-days** overall, excluding external review queues.

Handoff includes changed paths, exact command outcomes, semantic counterexamples, previews/publication links, docs/security impact and remaining gates. Current status: **planning only; implementation and publication unstarted**.
