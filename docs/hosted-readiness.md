# Workspace execution capacity and optional hosting

AcornOps remains self-hostable. An optional external controller can manage workspace plans and its own suspension hold through scoped admin APIs. Billing and commercial policy belong to that separate controller. AcornOps does not require a hosted account, billing service or external controller.

Each configured plan has five independent pools: Chat (`chat`), Agent (`agent`), Workflow (`workflow`), automatic investigations (`autoTriage`) and Insights (`insights`). Each pool has concurrent and outstanding limits. Outstanding includes queued, executing and approval/dependency waiting attempts; concurrent counts execution and bounded operations still settling. A Workflow child uses its parent's Workflow pool. Pools do not borrow from each other. Engine-wide local concurrency remains an additional worker bound.

Use [the five-pool example](examples/workspace-plans-hosted.json) as a starting point, selecting limits appropriate for the deployment. It is an example, not a recommended service tier. Supply its JSON as `WORKSPACE_PLANS_CONFIG_JSON` in Compose, or the equivalent `workspacePlans` object in Helm. Both limits must be positive integers with outstanding at least concurrent, or both null. Omitted pools normalize to unlimited. Hosted activation should use the CLI's `--require-finite` check. Existing plan keys have immutable limit definitions: create a new key to change limits, and explicitly reassign workspaces.

## Runtime configuration

| Setting | Default | Services |
| --- | --- | --- |
| `WORKSPACE_CAPACITY_ENABLED` | `false` | Control plane, execution engine, gateway |
| `WORKSPACE_ADMISSION_ENABLED` | `true` | Control plane |
| `WORKSPACE_DISPATCH_ENABLED` | `true` | Control plane |
| `WORKSPACE_CAPACITY_LEASE_SECONDS` | `30` | Control plane |
| `WORKSPACE_CAPACITY_QUEUE_SECONDS` | `600` | Control plane |
| `ORCH_BASE_URL`, `ORCH_SERVICE_TOKEN` | Track-specific internal connection | Engine and gateway |

Helm exposes the first three settings under `workspaceCapacity.enabled`, `workspaceCapacity.admissionEnabled` and `workspaceCapacity.dispatchEnabled`. The gateway needs its control-plane connection even when capacity limits are off: lifecycle checks always apply. Keep the service credential in the existing secret store; never place it in browser configuration.

Workspace provider credentials remain the first choice. A self-hosted installation may configure its existing platform fallback. A hosted operator should omit shared fallback keys when workspace BYOK is required; no automatic shared-key requirement is introduced.

## Initial rollout or catalogue change

Use component builds containing the hosted-readiness contracts. The existing pinned production image tags are not evidence that these unreleased changes are available. Build and test a coherent stack, then update release pins through the normal release process.

For an already activated installation, **close admission and dispatch on every control plane before changing capacity mode or the catalogue**. Keep the current mode and catalogue while executing work drains and bounded operations settle. Then follow the steps below with both gates kept closed throughout. An activated control plane intentionally rejects a changed mode or catalogue while either gate is open. Add new immutable plan keys instead of changing existing limit definitions.

1. Apply all additive control-plane migrations using the usual migration job. Preserve the reservation, operation, policy-receipt and cancellation tables.
2. Deploy compatible services with capacity disabled. For an existing activated installation, keep both control-plane gates closed as required above. Verify `/health` advertises `capacity_contract_version: 1` on every control plane, engine and gateway.
3. Close admission and dispatch on every control plane if they are not already closed. In Compose set both gate variables to `false`; in Helm set both gate values to `false`. Existing executing work may drain. Resolve or cancel active work and wait for bounded operations to finish; retained queued work and valid approval waits may be backfilled.
4. Create a local peer JSON file containing **every replica**, not load-balanced service URLs. Each entry is `{ "service": "control-plane" | "execution-engine" | "llm-gateway", "url": "http://replica:port" }`. Include at least one of each service. The CLI checks contract support, mode agreement and every control-plane catalogue hash and closed gates.
5. In the control-plane environment, with the same catalogue/database and both gates closed, run `npm run capacity:rollout -- prepare peers.json --require-finite`. This backfills retained attempts with server-owned pool classification and records the prepared catalogue. For self-hosted deployments intentionally using unlimited pools, omit `--require-finite`.
6. Restart all compatible services with capacity enabled while keeping control-plane gates closed. Run `npm run capacity:rollout -- verify peers.json --require-finite`. Only a matching prepared catalogue and compatible peers can be marked verified.
7. Open admission and dispatch. Startup rejects an enabled but unverified or mismatched catalogue. Monitor queued/outstanding usage and cancellations before widening traffic.

Run peer checks from a trusted deployment network. Provide direct addresses for all replicas: the CLI cannot discover replicas omitted from its input. Do not leave old, contract-unaware control planes or workers serving traffic during activation. This is a quiesced rollout.

Legacy attempts without an authoritative reservation timestamp are conservatively
fenced by existing suspension history. Backfill preserves that unknown ordering;
it does not turn retained work into a new post-restore attempt. If an older CLI
already backfilled reservations using rollout time, keep both gates closed and
reconcile retained attempts in workspaces with suspension history before reopening
traffic. Those records have no provenance marker: cancel ambiguous attempts and
create fresh authorized attempts only after checking uncertain side effects. Do
not delete suspension history or manually change timestamps to resume old work.

## Suspension and recovery

Administrative and external holds are independent; either suspends the workspace. Clearing one does not clear the other. Suspension cancels accepted queued work and requests cancellation of executing work. Durable cancellation intent survives a rapid restore. Restoring access permits new attempts and never automatically replays cancelled attempts.

Lease expiry stops new model/tool dispatch. Bounded in-flight operations continue to occupy capacity until completion or their recorded deadline. An uncertain write is never automatically rerun merely because a lease expired. Investigate its outcome before an intentional new attempt.

A plan downgrade defaults to rejection when existing resource or execution usage exceeds the new limits. Explicit `retain_existing` preserves resources and admitted work; new work waits or is rejected according to the new pool limits until usage drains. It does not delete data.

## Rollback

Close both gates, drain execution and settle bounded operations first. Keep compatible lifecycle and ownership code running. To disable limits, restart compatible services in disabled mode with gates closed, run `npm run capacity:rollout -- deactivate peers.json`, then reopen gates. Preserve ledgers, holds and uncertainty evidence. Rolling back to code that does not understand these tables or suspension semantics is outside this procedure.
