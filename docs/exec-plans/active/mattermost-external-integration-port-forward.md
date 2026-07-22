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

## Validation Log

- Baseline: `task validate` passed on untouched `main`.
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
