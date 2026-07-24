# Mattermost External Integration Port Forward

## Goal

Port Ryan Goh's four cumulative deployment pull requests (#5, #6, #7, and
#14) onto `temp-main`, preserving their commits while wiring the Mattermost
external integration into the current local, VM, and Kubernetes deployment
contracts without regressing newer platform settings.

Central tracking: acornops/acornops#12.

## Constraints

- Merge existing PR commits; do not squash, rebase, cherry-pick, or force-push.
- Preserve current `AGENTK_*`, `AGENTV_*`, `ASSISTANT_*`, OIDC admission,
  prelink/logout, catalog, automation runtime, image matrix, compose, and Helm
  behavior.
- Keep secrets in Secret-backed inputs and non-secret policy in ConfigMaps or
  environment configuration as appropriate.
- Any development webhook access to a private/local Mattermost bot must use
  exact private-host allowlisting supported by the current control plane. Do not
  restore `WEBHOOK_ALLOW_INSECURE_DEV_DELIVERY` or an equivalent broad bypass.
- Maintain parity across local examples, VM examples, Helm values/templates,
  schema, README tables, and contract manifests.

## Wave Scope

1. External client capability caps and grant configuration.
2. Workflow/webhook client configuration and secrets.
3. Durable issue webhook delivery configuration and observability.
4. Write-run and approval capability configuration.

## Decision Log

- 2026-07-22: `temp-main` was created from deployment `main` at `bd192c7`.
- 2026-07-22: Existing PRs remain the merge vehicles for attribution.
- 2026-07-22: Current deployment names, profiles, security defaults, and image
  compatibility matrix are authoritative.
- 2026-07-22, Wave 2: The old broad
  `WEBHOOK_ALLOW_INSECURE_DEV_DELIVERY` switch is not part of the current
  control-plane contract and is intentionally not restored. The deployment
  already passes `WEBHOOK_EGRESS_ALLOWED_PRIVATE_HOSTS_JSON`; local and VM
  examples now show how to opt an exact HTTPS Mattermost bot hostname into
  private-address delivery without weakening URL, DNS, redirect, or reserved-
  address protections.
- 2026-07-22, Wave 3: Durable delivery remains Postgres-backed and runs on each
  control-plane replica with bounded per-replica and per-origin concurrency. The
  eight worker, retry, payload, and subscription settings are propagated across
  local, VM, Helm, production-example, and contract-manifest surfaces. Pausing
  the worker stops claims without dropping newly enqueued events; the obsolete
  insecure-delivery switch remains absent.
- 2026-07-22, Wave 4: External clients remain read-only by default. Operators
  must add `create_read_write_runs` to a client's deployment-owned capability
  ceiling before a user can grant write-run and exact-origin approval access.
  Descriptor examples retain the current `sha256` and `enabled` fields rather
  than restoring the older `tokenSha256` shape.
- 2026-07-23, production sweep: Clarified that worker concurrency is bounded
  per control-plane replica, not globally, and that the configured lease must
  cover the worst-case same-origin batch. This keeps scaling guidance aligned
  with the implemented worker rather than implying cross-replica coordination
  that the deployment does not provide.

## Validation Log

- Baseline: `task validate` passed on untouched `main`.
- Wave 1: `task validate` passed after propagating the external integration
  capability ceiling across local and VM client examples.
- Wave 2: `task validate` passed after reconciling the obsolete insecure webhook
  switch to the current exact-private-host contract. Deployment contracts,
  harness, local fixture profiles, Linux install dry-run, Python standards,
  Helm chart, release matrix, production edge, and production image checks all
  passed.
- Wave 3: `task validate` passed after durable worker contract propagation.
  Contract, harness, local fixture, Linux install, Python standards, Helm,
  release matrix, production edge, and production image checks all passed.
- Wave 4: `task validate` passed after documenting the opt-in write-run
  capability ceiling and aligning the Helm descriptor example with the current
  control-plane parser. Contract, harness, local fixture, Linux install, Python
  standards, Helm, release matrix, production edge, and production image checks
  all passed.
- Production sweep: `task validate` passed after the worker scaling and lease
  guidance was reconciled. Contract, harness, local fixture, Linux install,
  Python standards, Helm, release matrix, production edge, and production
  image checks all passed.
- Each wave: run targeted rendered-config assertions, `task validate`, platform
  contract checks with sibling repositories, and Helm/Compose render checks.
- Final: bring up the integrated local stack and exercise Mattermost linking,
  webhook delivery, workflows, executions, and approvals.

## Completion Criteria

- PRs #5, #6, #7, and #14 are merged with merge commits into `temp-main` in
  order, with Ryan's commits reachable.
- Local, VM, and Kubernetes deployment contracts remain internally consistent.
- A draft `temp-main` to `main` PR is ready for manual review and not
  automatically merged.
