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

With three replicas, one rollout can retain three old pods while three
replacements run. Reserve CPU, memory, pod slots and namespace quota for that
overlap, including simultaneous service rollouts and rollback. Steady-state
capacity plus one surge pod can be insufficient: after the first replacement
becomes ready, an old pod may continue consuming quota for its full drain
window and block the next replacement.

The chart sets `progressDeadlineSeconds` to the larger of 600 seconds or the
component's termination grace plus 300 seconds. Defaults are 600 seconds for
control plane and gateway, and 1200 seconds for execution engine. This allows
a full old-pod termination window plus progress margin; it does not reserve
capacity or bound the total rollout. Kubernetes reports stalled progress when
this deadline expires; it does not itself terminate the draining pods or roll
back. See [Deployment progress and terminating pods](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/).

Set an explicit Helm operation timeout for upgrades and rollbacks. Calculate
from the slowest service's replica count, possible serial termination windows,
migration hooks and replacement startup under the actual resource/quota limits.
For the default three execution-engine replicas, three serial 900-second
termination windows allow 45 minutes; an illustrative 15-minute allowance for
migrations and startup gives `--timeout 60m`. Recalculate for custom replicas,
budgets, slow hooks, placement and concurrent rollouts. Helm's default is five
minutes; `--atomic` can initiate rollback if readiness does not complete within
that operation timeout. A release can also become ready before old pods exit,
so a longer Helm timeout alone does not verify drain completion. See
[Helm 3 upgrade options](https://helm.sh/docs/v3/helm/helm_upgrade/) and
[rollback options](https://helm.sh/docs/v3/helm/helm_rollback/).

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

Only a trusted HTTP 503 with error code `SERVICE_DRAINING`, message
`Service is draining`, `retryable: true` and `outcome: not_started` grants
permission to replay an otherwise
non-idempotent request. Connection errors, redirects, provider failures and
uncertain writes do not. Stable logical identities and approval receipt fencing
remain in force.

## Operating a restart

1. Validate the chart and contracts, and verify the deployed service versions
   implement the drain contract. If any old binary lacks draining, complete
   [the first cutover](#first-cutover-from-binaries-without-draining) below.
2. Confirm healthy replicas, replacement capacity, aligned grace periods and
   durable PostgreSQL/Redis availability. Capacity enforcement remains an
   independent setting; this feature does not enable it.
3. Record the existing pod names and UIDs for each intended Deployment. Run
   `kubectl --context <context> -n <namespace> rollout restart
   deployment/<name>` for the intended deployment and watch rollout status,
   readiness, active runs and terminating pods. A rollout can report new replicas
   available while old pods are still draining; verify every recorded old UID
   has disappeared before declaring the restart fully complete. Retain scoped
   old-pod logs and inspect any drain-deadline or forced-exit messages.
4. Check accepted runs reach the expected durable terminal state, queued work
   progresses, cancellation still takes effect, and no duplicate tool actions
   occurred. Investigate deadline-exceeded shutdowns rather than retrying an
   uncertain write.

Rollback to a binary without draining removes the restart guarantee. Keep
compatible data/contracts and use a controlled maintenance window for that
rollback. Longer Kubernetes grace alone cannot make an old process drain.

## First cutover from binaries without draining

Use a maintenance window. Preserve the old image digests, values, schema
inventory and applicable backup/restore evidence from the
[installation and upgrade procedure](OPERATIONS.md#installation-and-upgrade-paths).
Keep PostgreSQL, Redis and application dependencies available throughout.

1. Inventory every source of new work: browser/API submissions, operator jobs,
   schedules, webhook/event triggers, automation, auto-triage and other enabled
   background producers. Pause each using controls supported by the installed
   version that take effect without restarting application processes, or pause
   the source upstream. Record the prior settings for restoration.
2. Put new-work routes into maintenance at the edge and stop direct clients
   that bypass it. Keep monitoring and cancellation routes, existing agent
   connections and reconnect paths, internal callbacks, lease renewals and
   CP/EE/gateway communication available. Verify a new submission is blocked
   while monitoring and cancellation still work. A blanket block of `/api` or
   the internal network can interrupt the work being allowed to finish.
3. Leave the old applications running. Observe durable run state and tool/
   provider activity until accepted queued, dispatching and executing work has
   settled and no producer creates more work. Resolve approval waits explicitly;
   if cancelling a run, wait for its durable terminal state and bounded
   operations to settle. Investigate uncertain writes before an intentional
   retry. Check every replica and worker, including active claims and callbacks,
   rather than using an empty browser queue as evidence of idleness.
4. Only after that verification, stop the old application replicas without
   stopping their stores. Deploy the coherent, provenance-verified compatible
   image/chart set with admission, dispatch and autonomous producers kept
   closed. Run only the migrations required by the selected upgrade path.
   Verify no old binary remains and that every new replica is healthy and uses
   the intended contracts and budgets.
5. With producers paused and edge access restricted, open the required startup
   gates on the new compatible replicas for controlled smoke tests. Verify any
   resulting rollout completes, then check retained data, cancellation, tool
   outcomes and queue progress. Restore producers and edge access in a
   controlled order before reopening all traffic.

`WORKSPACE_ADMISSION_ENABLED`, `WORKSPACE_DISPATCH_ENABLED` and worker environment
switches are startup settings. Changing them through Helm or Compose can restart
old binaries: do not use that rollout to establish the initial quiescence in
steps 1–3. If an installed producer has no live pause or upstream stop control,
arrange verified natural idleness or deliberate cancellation before proceeding;
the runbook cannot promise a lossless first cutover while it keeps creating work.
Apply the same quiescence requirement before rolling back to old binaries.

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
