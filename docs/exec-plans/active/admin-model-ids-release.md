# Admin-managed model IDs release and demo upgrade

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

| Component | Proposed release | Previous demo pin |
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
- [ ] Run fresh application, deployment, contract and browser checks. Distinguish
  missing local OS screenshot baselines from product failures; Linux CI must pass.
- [ ] Commit focused changes and fast-forward main in each affected repository;
  push without force and wait for exact-SHA CI success.
- [ ] Publish unique application tags, wait for successful image releases, and
  verify registry digests and provenance against the tagged commits.
- [ ] Validate and publish chart .25 only after every pinned artifact exists;
  verify OCI publication and the chart repository mirror.
- [ ] Update only demo version pins and the explicitly approved feature opt-in.
  Confirm no competing deployment, validate Ansible and secrets references,
  then push once and follow the existing leased deployment workflow.
- [ ] Verify all workloads, ingress/TLS and public routes; compare PVC identities
  and enrolled-agent state with the baseline. No paid chat calls.
- [ ] Record final versions, commits, CI/release/deploy runs, validation results,
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
main is `9a3bd4b19a7349328b40e513b48d04dabe0b8dcf`. Exact-SHA CI is pending.

The local macOS route check stopped because only Linux route snapshots are
tracked. Its generated macOS images were moved out of the checkout, not accepted
as new baselines. This is not a passing full-browser gate; Linux CI remains
required. Standard Management Console validation and design-system snapshots
passed before that boundary. Full fixture/parity suites are run separately.
