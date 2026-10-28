# Graceful rolling restarts implementation plan

**Goal:** Let accepted assistant and Workflow runs finish during ordinary Kubernetes rolling restarts, with bounded shutdown, durable queued work, and safe client reconnection.

**Authorization:** The user approved implementation on 2026-10-29 after reviewing the drain design and regression risks. Implement and validate without another design gate. Production rollout is not part of this task.

**Architecture:** Each service owns a small running/draining/stopping lifecycle. A first termination signal closes admission, makes readiness fail, and preserves the dependencies needed by accepted work. Healthy replicas accept new work. Existing PostgreSQL and Redis state remain authoritative; active execution is not migrated between pods.

**Tech stack:** TypeScript/Express, Python/FastAPI/Uvicorn/asyncio, PostgreSQL, Redis, React, Helm, Docker and Kubernetes.

## Scope and decisions

- Branch: `feat/graceful-rolling-restarts` in control-plane, execution-engine, llm-gateway, management-console and acornops-deployment.
- Preserve unrelated offline-agent and certificate-lifecycle planning files. Work on dedicated branches in the existing sibling checkout to preserve its integration layout and installed dependencies.
- No database migration, new service, queue, shared runtime package, agent protocol change, arbitrary crash resumption, or public success-response change.
- Keep existing inference and tool execution policies. Do not introduce a shorter total-attempt or preparation limit as part of this change. Shutdown remains explicitly bounded; operations exceeding the configured window cannot be promised uninterrupted completion.
- Keep existing ownership fencing, permissions, approval receipts, stable operation IDs, terminal-state guards and outbox recovery.
- Authentication failures and ambiguous dispatched operations are never treated as safe drain rejections.
- Native signal handling starts draining; no externally callable drain administration endpoint is required.
- One deadline starts on the first signal. Repeated signals cannot extend it. Liveness must distinguish a healthy draining process from a failed essential worker.
- Configure `SERVICE_DRAIN_TIMEOUT_SECONDS`: control-plane 150, gateway 210, engine 870. Reserve at most 20 additional seconds for final shutdown; Helm termination grace is respectively 180, 240, 900 seconds. Processes exit early when finished.
- Use explicit rollout defaults `maxUnavailable: 0`, `maxSurge: 1`, `minReadySeconds: 5`. Terminating pods may overlap and require resource and provider-capacity headroom.

## Integration contracts

1. Before admission, draining HTTP listeners return status 503, `Retry-After: 1`, connection-close behavior for HTTP/1.1, and `{ "error": { "code": "SERVICE_DRAINING", "message": "Service is draining", "retryable": true, "outcome": "not_started" } }`. Only this exact trusted internal classification permits retry of an otherwise non-idempotent request. No redirect or arbitrary upstream error can grant replay permission.
2. Capacity acquire and renew add optional integer `leaseRemainingMs` computed from PostgreSQL's actual lease and clock. Keep `leaseSeconds` and `contractVersion: 1`. Consumers derive a conservative monotonic deadline from request start, not response receipt. Missing metadata retains legacy conservative failure behavior. Definite revocation, malformed authority metadata and expiry stop execution.
3. Control plane adds service-authenticated `POST /internal/v1/runs/cancellation-status`, body `{ "runIds": [...] }`, at most 100 distinct nonempty bounded IDs, response `{ "cancelledRunIds": [...] }`. Query interactive and Workflow durable cancellation state. No execution lease is required to observe cancellation. Engine polls only locally owned work every two seconds in bounded batches, including during drain. Old-server 404/405 retains the existing direct cancellation path without falsely canceling runs.
4. Redis agent-owner records add optional `state: "active" | "draining"`; absence means active. Changes, renewal and deletion remain fenced by instance and connection identity. Internal RPC adds `OWNER_DRAINING` only when the command was not sent. Never reinterpret timeout, failed publication, disconnect or arbitrary command failure as not started.
5. Agent handoff waiting has a maximum 45-second allowance (`AGENT_HANDOFF_TIMEOUT_MS=45000`), applied only before command dispatch and bounded by shutdown/run cancellation. Gateway builtin transport/operation budgets and engine tool transport must cover this allowance without widening the actual agent/tool execution deadline. Preserve stable logical tool IDs and claim each approval receipt once.
6. Mirrored contracts document compatibility order: consumers understand optional fields and drain errors before behavior is enabled throughout the deployment. The initial cutover and rollback require controlled operation; old binaries do not gain drain guarantees.

## Review focus and acceptance boundaries

- A signal during awaited authorization or handshake cannot create untracked work after admission closes.
- A result removed from a pending-command map is not complete until its RPC publication and accepted caller processing finish.
- A client disconnect does not prove an accepted asynchronous handler has stopped using dependencies.
- An interrupted acquire/renew response must not invent a fresh lease or permit a second owner to execute.
- Receipt claims, operation registration and dispatched writes must remain single-use under drain retries and ambiguous failures.
- Queued, scheduled-but-not-running, active, approval-waiting and dependency-waiting work require distinct handling.
- Same-version restarts, mixed versions, capacity on/off, internal TLS on/off, normal operation, deadline expiry and real worker failure all need coverage.

## Task 1: Control-plane lifecycle and additive contracts

Files: `src/server.ts`, both Express apps, a focused lifecycle module, agent connection/handshake/JSON-RPC code, coordination owner/RPC modules, interval/background-work ownership, internal capacity and cancellation routes/repositories, relevant tests and docs.

- [x] Write and run failing lifecycle tests for health/readiness, admission before effects, retained accepted work, duplicate signals and bounded exit.
- [x] Implement draining without dropping command replies; stop new background claims and await already-running dependency users.
- [x] Track RPC envelopes through publication; preserve outgoing response subscription until callers finish. Close unauthenticated sockets as well as registered agents.
- [x] Implement bounded owner handoff only before dispatch; test ownership replacement and no replay of uncertain writes.
- [x] Add accurate remaining lease metadata and cancellation-status batch reads, with validation/auth/SQL tests.
- [x] Update producer contracts and operational documentation; run targeted tests, `npm run validate`, real PostgreSQL cases and process/Redis checks.

## Task 2: Gateway lifecycle and safe boundary retries

Files: new ASGI drain component, `app/service_server.py`, `app/serve.py`, `app/main.py`, settings, error envelope, `execution_capacity.py`, `internal_transport.py`, focused tests and mirrored contracts.

- [x] Prove SIGTERM after response headers preserves stream body, generator finalization and authority cleanup; prove new writes cannot consume receipts.
- [x] Count accepted work through the full ASGI call; serialize signal callbacks with event-loop admission; maintain probe/listener behavior through drain.
- [x] Retry authority reads and idempotent finishes within a bounded budget. Retry operation begin only after explicit trusted pre-admission rejection.
- [x] Retry rejected builtin dispatch inside the existing admitted request, settle its old operation before resetting, preserve one approval claim, and keep ambiguous results fenced.
- [x] Cover handoff allowance and shutdown budget; update docs/contracts and run `task validate` plus subprocess/TLS tests.

## Task 3: Execution-engine lifecycle, ownership and cancellation

Files: runtime/supervisor/app, registry and scheduling, capacity, orchestrator/gateway/tool clients, config, lifecycle/recovery/authority tests and docs.

- [x] Prove dispatch creates no reservation after drain, every scheduling path stops, and active tasks finish without cancellation.
- [x] Release all unscheduled queued claims promptly without releasing scheduled ownership; keep renewals, cancellation, delivery and finalization alive.
- [x] Test remaining-lease deadlines, temporary renewal failure, permanent revocation, missing metadata and expiry.
- [x] Observe durable cancellation during drain without directing traffic to a pod address; keep legacy fallback conservative.
- [x] Retry only explicit gateway pre-admission rejection with the same tool identity/receipt; never replay a started stream or ambiguous write.
- [x] Run `task validate`, real subprocess SIGTERM/TLS checks, real Redis races and lifecycle integration checks.

## Task 4: Console recovery

Files: run status polling and active-run watcher, existing retry classifier, focused client/submission tests and reliability docs.

- [x] Prove one transient HTTP failure does not abort terminal-state polling; 401/403 and permanent failures still stop.
- [x] Preserve bounded backoff and continued state reconciliation while a run remains active, even if SSE retries are exhausted.
- [x] Preserve pending accepted runs after a transient monitoring failure; reconcile durable state instead of presenting a fabricated run failure.
- [x] Keep message/run identity and existing event deduplication. Run targeted tests and `VITE_APP_DATA_MODE=control-plane npm run validate`.

## Task 5: Deployment and rollout validation

Files: three Deployment templates, Helm values/config validation, Compose stop grace, chart checks, focused rollout harness and operational docs.

- [x] Add rendered-manifest tests for rollout strategy, explicit per-service grace, application budgets, bad values and TLS/probe parity; watch relevant failures first.
- [x] Align Compose stop grace so local shutdown tests exercise the same lifecycle.
- [x] Add opt-in, isolated Kubernetes rollout tests covering active inference, agent command reply, queued work, cancellation and overlapping draining pods, using controllable fake providers/tools rather than paid calls.
- [x] Validate through actual Service/Ingress routing, not a service port-forward pinned to one pod.
- [x] Run `task validate`, platform contracts and available isolated local integration/rollout tests. Never restart the user's existing stack or a production context.

## Task 6: Independent review and final evidence

- [x] Review each service change against the contracts and high-risk boundaries, including normal operation and mixed versions.
- [x] Reproduce material review findings in failing tests, then fix and rerun appropriate suites.
- [x] Record exact commands, results, environment limitations and any remaining risks. No claim of seamless production behavior without completed rollout evidence.
- [x] Keep the coordinated branch/diff reviewable; update plans and operational guidance with implementation evidence.

## Baseline evidence

- Engine `task unit-test`: 348 passed, one existing Starlette/httpx warning.
- Gateway `task unit-test`: 740 passed.
- Console targeted API/retry/submission tests: 35 passed.
- Deployment `task k8s-chart-check`: passed.
- Control-plane `npm test`: failed under sandbox network restrictions and without an explicitly isolated test database. Provision isolated test dependencies before evaluating baseline code failures.

## Progress and rulings

- 2026-10-29: Three independent read-only service audits completed; exact admission, reply-publication, handshake, lease and receipt risks incorporated above.
- Ruling: Keep the existing sibling workspace on dedicated feature branches, preserving unrelated files, rather than creating disconnected worktrees that break sibling contract/integration discovery. Cost if wrong: concurrent local work must remain separated by file ownership.
- Ruling: Preserve runtime policy rather than silently imposing new whole-attempt limits. Cost if wrong: work exceeding the explicit drain window can still be interrupted; this is documented and tested as a deadline case.

## Integration evidence — 2026-10-29

- CP `npm run validate`: 1,416 tests and all gates passed at `24958b4`.
- GW `task validate`: 776 tests and 52 keyless scenarios passed; reviewed health metadata followup at `b2d4e3f` passed 35 focused tests and lint/contracts/harness checks.
- EE `task validate`: 385 unit tests and 29 keyless scenarios passed; native full suite 412 passed. Reviewed ownership followup at `ab93ab6` passed 69 lifecycle and 9 native/Redis tests.
- Console `VITE_APP_DATA_MODE=control-plane npm run validate`: 234 files / 1,226 tests and all gates passed at `abbad5c`.
- Deployment `task validate` and workspace platform contracts stop at the unrelated CP↔agentk `podLogsUnavailable` manifest mismatch introduced in agentk `d3351d9`. The drain contract mirrors match. All 13 remaining deployment validation commands passed independently, including chart, fixture, release and Compose checks.
- Literal Kubernetes rollout matrix passed with capacity disabled and enabled, using native CP `24958b4`, EE `ab93ab6`, GW `b2d4e3f` images. Both profiles cover active inference plus fresh work, cross-replica agent replies/owner handoff, queue recovery/capacity gates, durable cancellation and simultaneous old pods draining. Capacity-on used the native prepare/verify activation procedure.
- Task review closed both acceptance-harness findings: actual pod image IDs are checked against verified images, and durable accepted/client/user/run/assistant identity is asserted. Stronger complete native matrices passed again with capacity off and on, including 23 and 27 recorded image comparisons respectively. The broad review found one handoff configuration mismatch; the final scoped review approved its fix with zero remaining findings.

The full-stack test uses internal plaintext, a protocol agent and a controlled model fixture; native service tests cover TLS separately. This is bounded graceful restart evidence, not production rollout, arbitrary crash resumption or a promise that work beyond the drain deadline completes. No user stack or production cluster was restarted.

## Final handoff

Implementation and independent review are complete on local
`feat/graceful-rolling-restarts` branches. No production release, push or merge
was performed. The current aggregate contract check remains blocked by the
independently owned AgentK counterpart mismatch described above; it must be
aligned before claiming a green workspace integration gate.

| Repository | Final runtime/configuration commit |
| --- | --- |
| control-plane | `5210787ae0426dcf1f49754b840b382a9fef8dc5` |
| execution-engine | `ab93ab64a6196cd5b31e0ec77c59569b8d30ea9b` |
| llm-gateway | `b2d4e3f6249c9ea033950dcc9d87b9a823d241f9` |
| management-console | `abbad5c` |
| acornops-deployment | `74d807f1785f186cb389e1d8b33b7912ea74b37f` (before this evidence-only update) |

The final CP/Helm fix rejects handoff settings outside integer `1..45000ms`;
tested valid defaults and lifecycle algorithms are unchanged. Its focused
configuration suite passed 72 tests, plus CP typecheck/build/harness/style and
actual Helm render/boundary/lint checks. No full runtime matrix was repeated
for that invalid-setting-only rejection. Existing custom grace overrides must
satisfy the documented drain-plus-30-second rule.

Exact final rollout commands, from this repository, were:

```sh
node scripts/k8s-drain-smoke.mjs --run --capacity off --kubeconfig /tmp/acornops-drain-kubeconfig --expected-cluster acornops-drain-20261029 --ingress http://127.0.0.1:18089 --cp-image acornops-drain-cp:24958b4 --ee-image acornops-drain-ee:ab93ab6 --gw-image acornops-drain-gw:b2d4e3f
node scripts/k8s-drain-smoke.mjs --run --capacity on --kubeconfig /tmp/acornops-drain-kubeconfig --expected-cluster acornops-drain-20261029 --ingress http://127.0.0.1:18089 --cp-image acornops-drain-cp:24958b4 --ee-image acornops-drain-ee:ab93ab6 --gw-image acornops-drain-gw:b2d4e3f
```

Both passed using native images and the reviewed harness at `94a51fe`.
Logs: `/tmp/acornops-drain-rollout-off-final.log` and
`/tmp/acornops-drain-rollout-on-final.log`. Redacted per-case identity, image,
RPC, pod and fixture evidence is in the corresponding temporary report folders
`acornops-drain-mvsi4kq0-2ee293` and `acornops-drain-mvsi8wjl-392be4`.
Reproduction requires rebuilding/importing current committed images and a new
isolated cluster; see the [acceptance instructions](../../../kubernetes/rollout-smoke/README.md).

`task k8s-drain-check` passed 18 fixture/configuration/identity tests.
`task k8s-chart-check` passed, including exact 1/30000/45000 and invalid
0/-1/1.5/45001/60000 handoff boundaries. All other 13-command deployment checks
passed independently after `task validate` stopped at the external contract
mismatch. The diagnostic current-manifests plus pre-log-change AgentK snapshot
passed both contract checkers; this isolates provenance and does not replace the
failing current-workspace gate.

Ownership-verified cleanup removed only this task's isolated Kubernetes cluster,
PostgreSQL/Redis containers and disposable image tags. The default Kubernetes
context remains `k3d-acornops-demo-cluster`. No existing user stack was restarted.
Canonical/component logs and review records were retained separately under
`/tmp/acornops-graceful-restarts-evidence-20261029`.

Remaining limits are operational: initial cutover/rollback from older binaries,
forced termination/crash, drain-deadline overruns, and production resource sizing
need the procedures in the runbook. Real write-tool exactly-once behavior and
paid provider acceptance were not claimed by the fake-provider test. Existing
Starlette/httpx deprecation and Helm icon recommendation are unchanged baseline
noise; dependency cleanup was kept out of scope.
