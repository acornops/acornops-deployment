# Automatic MCP OAuth

## Goal

Wire the enabled-by-default MCP OAuth feature and its canonical public URLs,
Redis requirement, timeouts, and response limits through local, VM production,
and Kubernetes deployment tracks.

## Decisions

- `MCP_OAUTH_ENABLED` defaults to `true`; `false` remains the rollback switch.
- Canonical callback and CIMD URLs derive from the configured public console
  URL, never request headers, and use its same-origin `/api` route so host-only
  browser session cookies remain available.
- Enabling OAuth requires gateway Redis and encrypted secret storage.
- Existing remote MCP kill-switch and egress controls apply to OAuth traffic.

## Work

- [x] Add compose and Helm environment/value wiring.
- [x] Extend values schema, contract manifests, examples, and operator docs.
- [x] Preserve generated-chart ownership and rollback through the feature flag.

## Validation

- Compose renders for production, Dex, Keycloak, and platform-admin: passed.
- Helm chart, local fixtures, Python standards, release matrix, production
  edge/image, Linux install, and harness checks: passed.
- Aggregate contract validation remains blocked by a pre-existing
  control-plane/AgentK manifest mismatch unrelated to MCP OAuth; all OAuth
  contract counterparts match.

## Cross-repository dependency

Consumes the gateway and control-plane configuration contracts. Merge last.
