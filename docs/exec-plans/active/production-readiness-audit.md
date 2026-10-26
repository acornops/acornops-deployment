# Production readiness audit — 2026-10-26

Status: **not approved for production yet**. Focused corrections passed local
validation and final independent review; their separately authorized experimental
publication and demo rollout are tracked in [Readiness fixes demo release](../completed/readiness-fixes-demo-release.md).
Security and target-environment acceptance gates below remain open. This record
is not a substitute for a production release rehearsal.

## Scope and release baseline

Reviewed the current workspace, recent model/MCP/VM/capacity changes, release
matrix, upgrade instructions, repository checks, browser regressions, and runtime
dependency advisories. The initial audit performed no styling redesign,
production access, paid provider requests, deployment reset, commit, push, or
release. The follow-up user request authorizes publication and a data-preserving
demo upgrade only; the linked release record owns that subsequent evidence.

All 11 repositories were fetched and their starting HEADs matched remote main.
The earlier uncommitted Management Console dialog-opacity fix was preserved.
Unrelated parent `tmp/` files were left alone. New work uses
`fix/production-readiness`; the console's original `fix/dialog-opacity-handoff`
changes joined that shared branch for coordinated publication.

Initial published matrix checked: platform chart `.26`, Management Console `.39`, Control
Plane `.38`, Execution Engine `.15`, LLM Gateway `.21`, Platform Admin Console
`.7`, AgentK chart `.13`, AgentV `.10` (all `0.0.1-experimental` releases).
`ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true task release-matrix-check` passed for the
configured images, charts, and AgentV assets. This establishes availability, not
inclusion of these new fixes, image-level vulnerability clearance, or production
acceptance. The subsequent authorized release updated pins only after component
artifacts were available; see the linked release record for the current matrix.

## Confirmed corrections

| Area | Defect and focused correction |
| --- | --- |
| AI policy | Removing the final permitted model could restore the entire deployment model/reasoning policy. Preserve the administrator's restrictions and unavailable selection; new runs fail closed until explicit repair. Newly submitted empty policies still fail validation. |
| Execution dispatch | Accepted/recovered work bypassed the dispatch pause when capacity quotas were disabled. Always consult the existing acquire endpoint, honor waiting, and retain the local semaphore without leases in disabled mode. |
| VM capacity findings | The first 50 mounts could all be Snap images, hiding a full later disk. Evaluate the bounded full filesystem result before retaining the same 50 inventory rows. Thresholds and immutable-type exclusions are unchanged. |
| VM issue recovery | Failed/incomplete telemetry could falsely resolve a real issue. Require positive collection coverage. Optional per-collector finding-coverage metadata also avoids leaving healed issues stuck when only raw inventory was trimmed. |
| HTTP dependencies | Refresh compatible body-parser, proxy-addr, and qs dependencies without changing Express or API configuration. Public/internal compressed-body smoke checks pass. |
| Other runtime dependencies | AgentK: fast-copy 4.1.0, ip-address 10.7.4, js-yaml 4.3.2. Execution Engine: AnyIO 4.14.2 and Certifi 2026.10.19. Other runtime versions are preserved. No framework major upgrades or unrelated runtime code changes. |
| Upgrade instructions | Remove the contradictory unconditional database-recreation instruction. Ordinary verified forward upgrades preserve databases, migration history, and secrets. |

VM metadata is additive and retains snapshot schema v2. Older receivers ignore
it; new receivers use conservative inventory evidence for older agents. Upgrade
AgentV on existing hosts to restore complete finding/recovery coverage when the
affected mount is outside retained inventory. A platform redeploy alone does not
upgrade installed agents. No new database migration is introduced by this audit.

Independent review caught a preliminary recovery implementation that confused
inventory truncation with incomplete findings. It was corrected and re-reviewed;
filesystem and service byte-budget cases now have regression coverage. Final
model-policy, VM, and execution-dispatch reviews found no further actionable
issues in those changes.

## Validation evidence

Logs are retained locally under `/tmp/acornops-production-audit-krjHWi/`.
Database checks used uniquely named disposable PostgreSQL/Redis containers, not
the existing local platform or demo. No production database/secret store was read.

| Repository/check | Command and result |
| --- | --- |
| Workspace | `task validate` — harness, contracts, conventional commits, runtime truth passed. |
| Control Plane | `npm run validate` with isolated `DATABASE_URL`, `CONTROL_PLANE_TEST_DATABASE_URL`, and `REDIS_URL` — 1,340 tests plus type/style, authz, membership, durability, contracts, OpenAPI, harness, build passed. |
| SQL migrations | `npm run db:migrate` applied 001–012 to the disposable database. `CONTROL_PLANE_MIGRATION_TEST_DATABASE_URL=<disposable-db> npm run migrations:check` passed synthetic SQL upgrade checks and removed its temporary schema. |
| Execution Engine | `task validate` after dependency patches — 297 unit tests, 29 keyless scenarios, Ruff, contracts, harness passed; hash-locked install and `pip check` passed. |
| LLM Gateway | `task validate` — 735 unit tests, 52 keyless scenarios, Ruff, contracts, harness passed. |
| AgentV | `npm run validate` — 100 tests, type/lint, contracts, harness, build passed. Real parser/serializer tests use controlled host-command output, not a live Linux/systemd host. |
| AgentK | Post-patch `npm ci --ignore-scripts --no-audit` and `npm run validate` — 258 tests, type/lint, contracts, harness, three Helm lint configurations/templates, build passed. Installed/locked versions and dependency ranges verified. |
| Management Console | `npm run validate:full` passed 1,189 unit tests, build/budget/static checks and 27 design-system cases (one intentional skip), then failed route screenshots because this macOS checkout has no corresponding baseline. `npm run smoke:fixtures` passed 288 browser tests; `npm run smoke:mcp-parity` passed 24. |
| Platform Admin Console | `npm run validate` — 104 tests, build, contracts, harness, route checks passed. |
| Deployment | `task validate` — profile/startup/install, Helm, release matrix, production edge/image and Compose checks passed. |
| Docs website | `npm run validate` — canonical checks and Mintlify build validation passed after permitting its local cache access. |

The console's generated macOS screenshots were moved out of the checkout; no
baseline was approved or changed. Run route visual comparison on the established
Linux CI image before release. Initial missing-database and sandbox-localhost
failures were retried with isolated services/access and are not counted as passes.

## Focused dependency qualification

The user approved patched Zod 4 qualification and Nodemailer remediation in the
current checkouts on `fix/runtime-validation-security`. This follow-up does not
authorize a new release or demo deployment; the published matrix is unchanged.

- Control Plane, AgentK, and AgentV now lock Zod 4.6.7. Existing array maxima reject
  excess collections before reading elements. Tests reproduce the former
  amplification and verify the new behavior, including nested RBAC collections.
- Zod compatibility adaptations preserve nested deployment defaults, partial
  update omission, legacy arbitrary payload optionality, and protocol envelopes.
  Agent converters now use native input-schema conversion. AgentV `query_logs`
  fields and strictly positive PID constraints are advertised correctly; they
  were already enforced at execution. Error-detail wording and rejection of
  malformed timestamps/UUIDs or unsafe integers follow Zod 4.
- Control Plane now locks Nodemailer 10.1.4 and uses its bundled types. The email
  service is unchanged. Real loopback SMTP tests verify both token emails,
  configured credentials, recipient rejection, and required-TLS refusal before
  credentials or mail are sent. No real email was delivered.
- Fresh `npm audit --omit=dev --json` reports zero runtime advisories in all
  three repositories. This does not clear the broader resource-budget or image
  gates below. Final review/qualification evidence is maintained in each
  repository's `docs/exec-plans/completed/runtime-validation-security.md`.
- Full validation passed: Control Plane 1,354 tests plus separate SQL upgrade
  checks, AgentK 262 unit + 1 protocol test, AgentV 104 unit + 4 protocol tests
  and package smoke. Verified temporary Node 22.23.4 passed compatibility suites
  alongside the main Node 24.2.0 runs. Independent final review found no Critical,
  Important, or Minor issues in the migration. Main integration and demo release
  are now authorized and tracked in [the release plan](security-maintenance-release.md);
  the production gates below remain separate decisions.
- Both dependency-qualification test containers were stopped and auto-removed
  after verification, discarding only synthetic data. Existing local/demo
  services were untouched; evidence remains under
  `/tmp/acornops-validation-security-y4rx7q`.

## Remaining security gates

1. **Define early budgets for currently unconstrained collections.** The Zod
   [upstream patch](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) only bounds
   work where a schema declares an upper limit; it is not a general item/error
   budget. Control Plane webhook event types remain unbounded and are parsed
   after user authentication but before workspace mutation authorization. Open
   records also lack entry/depth budgets. Workflow IDs/tags, internal run-event
   batches, platform policy arrays, and operator configuration need separately
   justified limits at their respective trust boundaries. The Control Plane
   qualification plan inventories these inputs. Do not treat the 4 MiB body
   limit or a clean dependency audit as resolution. No arbitrary business limits
   were introduced in the approved compatibility-focused migration.
2. **Publish and qualify the patched artifacts.** The local changes are not yet
   merged or released. Rebuild and scan Control Plane/AgentK images and AgentV
   archives; test production-like SMTP and installed-agent upgrade paths before
   promotion. Installed VMs are not updated by a platform redeploy.
3. **Remediate or explicitly qualify the remaining image findings.** The subsequent
   experimental release scanned previous/rebuilt Linux images with Trivy: no new
   High/Critical package/advisory pairs, but existing OS and bundled npm-toolchain
   findings remain, including fixable ones. The console base image retains 58
   fixable findings. Execution Engine has no remaining fixed-version High/Critical
   findings, but retains unfixed OS findings. Refresh and qualify production base
   images/toolchains, then rescan. Application lockfile audit results do not cover
   the complete deployed image; no scanner suppression or security clearance was
   added. Exact counts and limits are in the release record.

Management/Admin Console runtime audits reported no known advisories. Execution
Engine's patched production lock reported none across 21 packages; Gateway's
production lock reported none across 72. Those earlier checks are distinct from
the fresh three-repository audits above. Zero audit findings is not a security
certification and does not update already published images or installed agents.

## Production promotion checklist

- [ ] Resolve the security gates above before production promotion. Experimental
  demo publication of the focused fixes does not waive these gates. Verify
  signatures/provenance and update the coordinated deployment matrix only after
  all artifacts exist, as recorded in the separate demo release plan.
- [ ] Confirm the actual installed release/chart, Kubernetes versus Compose,
  database ancestry, and MCP secret backend (database or Vault). They were not
  provided for this audit; no production-specific compatibility claim is made.
- [ ] Rehearse on a representative backup and verify coordinated database/secret
  restore. Preserve the immutable Control Plane 001 checksum and Gateway
  `a10047518e6a` ancestry; stop on unknown or divergent history.
- [ ] If crossing Control Plane 006 / Gateway `b20058629f4b` or `c3006973a8d2`, use
  the [MCP maintenance procedure](../../OPERATIONS.md): stop admission/scheduling,
  drain writers and cleanup work, validate endpoints/secrets, and communicate
  individual credential reconnect requirements. Do not apply this reset again to
  an installation already beyond the boundary. App-only rollback is insufficient.
- [ ] For capacity activation/catalog changes, verify every replica and closed
  gates using the [quiesced rollout](../../hosted-readiness.md). Synthetic queue
  tests do not replace multi-replica staging and restart/failover acceptance.
- [ ] Verify production-like OIDC/email, live model access/billing, MCP credential
  lifecycle (including the selected secret backend), AgentK connectivity, AgentV
  read-only/read-write policy, real-host restart/reboot, telemetry, and recovery.
  No paid requests, real VM service mutations, or production canaries were run.
- [x] Complete Linux visual CI and image scans for the experimental release;
  results are recorded separately and do not resolve the security gates above.
- [ ] Monitor production canary readiness, jobs, errors, and retained-work
  behavior before widening traffic.

No production teardown or automatic data reset is part of this work.
The two task-owned database/cache containers were removed after verification;
their synthetic test data was discarded. Existing local/demo services were untouched.
