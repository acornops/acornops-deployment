# Graceful rolling restarts

Control plane, execution engine and LLM gateway cooperate with Kubernetes pod
termination. A terminating process stops admitting work and fails `/ready`,
while `/health` stays healthy as long as its essential workers are functional.
Accepted work retains its database, Redis and transport dependencies until it
finishes or the drain deadline expires. The first termination signal establishes
one deadline; additional signals cannot extend it.

This applies to compatible binaries that implement the drain contract. It does
not resume arbitrary execution after a crash, forced deletion, node loss or a
deadline overrun. The first upgrade from older binaries needs a controlled
cutover because those binaries cannot drain. Existing incompatible schema or
protocol upgrade procedures still apply. This change itself adds no migration.

## Budgets and rollout settings

| Component | Application drain | Kubernetes termination grace | Compose variables |
| --- | ---: | ---: | --- |
| Control plane | 150 seconds | 180 seconds | `CP_DRAIN_TIMEOUT_SECONDS`, `CP_STOP_GRACE_SECONDS` |
| LLM gateway | 210 seconds | 240 seconds | `GATEWAY_DRAIN_TIMEOUT_SECONDS`, `GATEWAY_STOP_GRACE_SECONDS` |
| Execution engine | 870 seconds | 900 seconds | `EE_DRAIN_TIMEOUT_SECONDS`, `EE_STOP_GRACE_SECONDS` |

Helm values are `components.<component>.drainTimeoutSeconds` and
`terminationGracePeriodSeconds`. The former becomes
`SERVICE_DRAIN_TIMEOUT_SECONDS` in the container. The chart requires positive
integers and at least 30 seconds between the two budgets: at most 20 seconds
for cleanup and 10 seconds of shutdown headroom. Compose uses the same defaults;
keep both values aligned when overriding them. Processes exit early when their
accepted work finishes. These budgets do not change existing inference or tool
execution limits. Work exceeding the available drain window can be interrupted.

The three Deployments use `maxUnavailable: 0`, `maxSurge: 1` and
`minReadySeconds: 5`. Provide resources for replacement pods and terminating
pods to overlap. Kubernetes can retain several terminating pods beyond the
surge count while their accepted work finishes. A PodDisruptionBudget does not
replace Deployment rollout settings.

No `preStop` sleep is needed: the application handles SIGTERM and rejects late
admission during endpoint propagation. A custom `preStop` hook consumes the same
termination grace window and must be accounted for separately. Do not use
`--force`, zero grace, or a shorter external shutdown deadline when relying on
draining. Ensure the container entrypoint delivers signals to the application.

## What continues during drain

- The execution engine stops new scheduling and releases unscheduled queued
  claims. Active tasks keep their leases, cancellation polling, result delivery
  and finalization. Durable paused work resumes through the existing recovery
  path; active execution remains on its original pod.
- The gateway retains admitted streams through response-body completion and
  cleanup. New requests are rejected before receipt consumption or execution.
- The control plane retains admitted handlers, agent replies and RPC response
  publication. Agent connections close after their admitted commands settle;
  commands not yet sent can wait for an agent to reconnect to another replica.
- The console can reconnect its event stream and reconcile durable run/message
  state. A network failure or monitoring timeout does not establish run failure.

`agentGateway.handoffTimeoutMs` accepts integers from 1 to 45000 milliseconds,
defaults to 45000, and becomes
`AGENT_HANDOFF_TIMEOUT_MS` in all three services. This allowance is for waiting
before dispatch; it does not enlarge the actual tool execution timeout. Waiting
must stop when execution authority or cancellation says the run may not proceed.

Only a trusted HTTP 503 with error code `SERVICE_DRAINING`, `retryable: true`
and `outcome: not_started` grants permission to replay an otherwise
non-idempotent request. Connection errors, redirects, provider failures and
uncertain writes do not. Stable logical identities and approval receipt fencing
remain in force.

## Operating a restart

1. Validate the chart and contracts, and verify the deployed service versions
   implement the drain contract. For a first cutover, deploy compatible consumers
   before enabling new producer behavior and follow the maintenance procedure.
2. Confirm healthy replicas, replacement capacity, aligned grace periods and
   durable PostgreSQL/Redis availability. Capacity enforcement remains an
   independent setting; this feature does not enable it.
3. Run `kubectl --context <context> -n <namespace> rollout restart
   deployment/<name>` for the intended deployment and watch rollout status,
   readiness, active runs and terminating pods. A rollout can report new replicas
   available while old pods are still draining; wait for those pods to exit
   before declaring the restart fully complete.
4. Check accepted runs reach the expected durable terminal state, queued work
   progresses, cancellation still takes effect, and no duplicate tool actions
   occurred. Investigate deadline-exceeded shutdowns rather than retrying an
   uncertain write.

Rollback to a binary without draining removes the restart guarantee. Keep
compatible data/contracts and use a controlled maintenance window for that
rollback. Longer Kubernetes grace alone cannot make an old process drain.

## Verification

`task k8s-chart-check` renders plaintext and TLS deployments, custom budgets,
disabled components and invalid configurations. `task release-matrix-check`
also renders the VM Compose stop/drain defaults. Each service's lifecycle tests
exercise accepted work, first-signal deadlines, admission races and authority
cleanup. The coordinated implementation plan records the process and rollout
test evidence before release promotion.

`task k8s-drain-check` validates the controllable provider/agent fixture and
isolation guards. The opt-in [Kubernetes rollout acceptance test](../kubernetes/rollout-smoke/README.md)
runs native images through actual Service/Ingress routing in an isolated k3d
cluster, with capacity enabled and disabled in separate runs. Its report records
accepted-run outcomes, tool dispatch counts, owner handoff and old-pod exit.

The ordinary local source stack uses development watchers and Uvicorn hot
reload. Those entrypoints do not establish the production shutdown guarantee.
For source-based lifecycle tests, add `compose/local/compose.drain.yaml` after
the VM and source Compose files. It runs the same Python supervisors and the
control-plane server directly, without changing normal development commands:

```bash
docker compose -p acornops-drain-test \
  -f compose/vm-prod/compose.yaml \
  -f compose/local/compose.source.yaml \
  -f compose/local/compose.drain.yaml \
  --profile local --profile oidc-dex --env-file <isolated-test-env> config
```

Use isolated ports, databases and volumes before starting this test project;
the example above only renders it. `task local-fixtures:check` verifies the
merged native launch commands and matching budgets, and confirms ordinary
development retains hot reload. Production-image Kubernetes tests use the
Dockerfiles' direct server entrypoints.
